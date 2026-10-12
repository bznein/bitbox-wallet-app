// SPDX-License-Identifier: Apache-2.0

import AVFoundation
import UIKit
import WebKit

// Permission callbacks and capture work can outlive the screen that requested them.
private final class QRScanLifetime {
    private let lock = NSLock()
    private var cancelled = false
    private var foreground = true

    var shouldRun: Bool {
        lock.lock()
        defer { lock.unlock() }
        return !cancelled && foreground
    }

    func setForeground(_ value: Bool) {
        lock.lock()
        foreground = value
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

final class QRWebViewContainer: UIView {
    let webView: WKWebView
    lazy var qrScanner = NativeQRScanner(webView: webView, container: self)

    init(webView: WKWebView) {
        self.webView = webView
        super.init(frame: .zero)
        addSubview(webView)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func layoutSubviews() {
        super.layoutSubviews()
        webView.frame = bounds
        qrScanner.layoutPreview()
    }
}

final class NativeQRScanner: NSObject, AVCaptureMetadataOutputObjectsDelegate {
    private final class Session {
        let id: Int
        let lifetime = QRScanLifetime()
        let capture = AVCaptureSession()
        let output = AVCaptureMetadataOutput()
        let view = UIView()
        let preview: AVCaptureVideoPreviewLayer
        var geometry: [String: Any]
        // Access device only on captureQueue.
        var device: AVCaptureDevice?
        var observers: [NSObjectProtocol] = []
        var lastText: String?
        var lastResultTime: TimeInterval = 0

        init(id: Int, geometry: [String: Any]) {
            self.id = id
            self.geometry = geometry
            preview = AVCaptureVideoPreviewLayer(session: capture)
            preview.videoGravity = .resizeAspectFill
            view.backgroundColor = .black
            view.clipsToBounds = true
            view.layer.addSublayer(preview)
        }
    }

    private weak var webView: WKWebView?
    private weak var container: UIView?
    private let captureQueue = DispatchQueue(label: "ch.shiftcrypto.qr.capture")
    // Session identity and UIKit state are owned by the main thread.
    private var session: Session?
    private var appearance: (opaque: Bool, background: UIColor?, scrollBackground: UIColor?)?

    init(webView: WKWebView, container: UIView) {
        self.webView = webView
        self.container = container
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(suspend), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(resume), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    func handle(_ command: [String: Any]) {
        guard let id = command["sessionId"] as? Int, let action = command["action"] as? String else { return }
        if action == "start" {
            guard let geometry = command["geometry"] as? [String: Any], let webView = webView, let container = container else { return }
            stop()
            let current = Session(id: id, geometry: geometry)
            session = current
            current.lifetime.setForeground(UIApplication.shared.applicationState == .active)
            appearance = (webView.isOpaque, webView.backgroundColor, webView.scrollView.backgroundColor)
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear
            container.insertSubview(current.view, belowSubview: webView)
            layoutPreview()
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                configure(current)
            case .notDetermined:
                AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                    DispatchQueue.main.async {
                        guard let self = self, self.session === current else { return }
                        if granted { self.configure(current) }
                        else { self.fail(current, code: "permissionDenied") }
                    }
                }
            default:
                fail(current, code: "permissionDenied")
            }
            return
        }
        guard let current = session, current.id == id else { return }
        switch action {
        case "stop":
            stop()
        case "geometry":
            if let geometry = command["geometry"] as? [String: Any] {
                current.geometry = geometry
                layoutPreview()
            }
        case "focus":
            guard let x = command["x"] as? Double, let y = command["y"] as? Double, x.isFinite, y.isFinite else { return }
            let point = current.preview.captureDevicePointConverted(fromLayerPoint: CGPoint(
                x: min(1, max(0, x)) * current.view.bounds.width,
                y: min(1, max(0, y)) * current.view.bounds.height))
            control(current) { device in
                if device.isFocusPointOfInterestSupported && device.isFocusModeSupported(.continuousAutoFocus) {
                    device.focusPointOfInterest = point
                    device.focusMode = .continuousAutoFocus
                } else if device.isFocusPointOfInterestSupported && device.isFocusModeSupported(.autoFocus) {
                    device.focusPointOfInterest = point
                    device.focusMode = .autoFocus
                }
                if device.isExposurePointOfInterestSupported && device.isExposureModeSupported(.continuousAutoExposure) {
                    device.exposurePointOfInterest = point
                    device.exposureMode = .continuousAutoExposure
                }
            }
        case "zoom":
            guard let zoom = command["zoom"] as? Double, zoom.isFinite else { return }
            control(current) { device in
                device.videoZoomFactor = min(device.maxAvailableVideoZoomFactor, max(device.minAvailableVideoZoomFactor, CGFloat(zoom)))
            }
        case "torch":
            guard let enabled = command["enabled"] as? Bool else { return }
            control(current) { device in
                if device.hasTorch && device.isTorchAvailable {
                    device.torchMode = enabled ? .on : .off
                }
            }
        default:
            break
        }
    }

    private func configure(_ current: Session) {
        let center = NotificationCenter.default
        current.observers.append(center.addObserver(forName: .AVCaptureSessionRuntimeError, object: current.capture, queue: .main) { [weak self] _ in
            self?.fail(current, code: "cameraUnavailable")
        })
        current.observers.append(center.addObserver(forName: .AVCaptureSessionInterruptionEnded, object: current.capture, queue: .main) { [weak self] _ in
            guard let self = self, self.session === current else { return }
            self.startCapture(current)
        })
        current.observers.append(center.addObserver(forName: .AVCaptureSessionWasInterrupted, object: current.capture, queue: .main) { [weak self] _ in
            if current.lifetime.shouldRun { self?.fail(current, code: "cameraUnavailable") }
        })
        captureQueue.async { [weak self] in
            guard let self = self else { return }
            let devices = AVCaptureDevice.DiscoverySession(deviceTypes: [.builtInWideAngleCamera], mediaType: .video, position: .unspecified).devices
            guard let device = devices.first(where: { $0.position == .back }) ?? devices.first else {
                DispatchQueue.main.async { self.fail(current, code: "noCamera") }
                return
            }
            do {
                current.capture.beginConfiguration()
                defer { current.capture.commitConfiguration() }
                if current.capture.canSetSessionPreset(.hd1280x720) {
                    current.capture.sessionPreset = .hd1280x720
                }
                let input = try AVCaptureDeviceInput(device: device)
                guard current.capture.canAddInput(input), current.capture.canAddOutput(current.output) else {
                    DispatchQueue.main.async { self.fail(current, code: "cameraUnavailable") }
                    return
                }
                current.capture.addInput(input)
                current.capture.addOutput(current.output)
                guard current.output.availableMetadataObjectTypes.contains(.qr) else {
                    DispatchQueue.main.async { self.fail(current, code: "cameraUnavailable") }
                    return
                }
                current.output.metadataObjectTypes = [.qr]
                current.output.setMetadataObjectsDelegate(self, queue: .main)
                try device.lockForConfiguration()
                if device.isFocusModeSupported(.continuousAutoFocus) { device.focusMode = .continuousAutoFocus }
                if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
                device.videoZoomFactor = max(1, device.minAvailableVideoZoomFactor)
                device.unlockForConfiguration()
                current.device = device
            } catch {
                DispatchQueue.main.async { self.fail(current, code: "cameraUnavailable") }
                return
            }
            DispatchQueue.main.async {
                guard self.session === current else { return }
                self.layoutPreview()
                self.startCapture(current)
            }
        }
    }

    private func startCapture(_ current: Session) {
        captureQueue.async { [weak self] in
            guard let self = self, current.lifetime.shouldRun, current.device != nil else { return }
            if !current.capture.isRunning { current.capture.startRunning() }
            if current.lifetime.shouldRun && current.capture.isRunning {
                self.sendCamera(current, type: "ready")
            } else if current.lifetime.shouldRun {
                DispatchQueue.main.async { self.fail(current, code: "cameraUnavailable") }
            } else {
                current.capture.stopRunning()
            }
        }
    }

    private func control(_ current: Session, change: @escaping (AVCaptureDevice) -> Void) {
        captureQueue.async { [weak self] in
            guard let self = self, current.lifetime.shouldRun, let device = current.device else { return }
            do {
                try device.lockForConfiguration()
                change(device)
                device.unlockForConfiguration()
                self.sendCamera(current, type: "state")
            } catch {
                DispatchQueue.main.async { self.fail(current, code: "cameraUnavailable") }
            }
        }
    }

    // Called on captureQueue; pass a value snapshot back to the UI thread.
    private func sendCamera(_ current: Session, type: String) {
        guard let device = current.device else { return }
        let camera: [String: Any] = [
            "hasFlash": device.hasTorch && device.isTorchAvailable,
            "isFlashOn": device.torchMode == .on,
            "zoom": device.videoZoomFactor,
        ]
        DispatchQueue.main.async {
            if current.lifetime.shouldRun { self.send(current, event: ["type": type, "camera": camera]) }
        }
    }

    func layoutPreview() {
        guard let current = session, let webView = webView,
              let p = normalizedRect(current.geometry["preview"]),
              let radius = current.geometry["radius"] as? Double, radius.isFinite else { return }
        let size = webView.bounds.size
        let frame = CGRect(x: p.minX * size.width, y: p.minY * size.height, width: p.width * size.width, height: p.height * size.height)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        current.view.frame = frame
        current.view.layer.cornerRadius = CGFloat(radius) * frame.width
        current.preview.frame = current.view.bounds
        if let connection = current.preview.connection, connection.isVideoOrientationSupported {
            switch webView.window?.windowScene?.interfaceOrientation {
            case .landscapeLeft: connection.videoOrientation = .landscapeLeft
            case .landscapeRight: connection.videoOrientation = .landscapeRight
            case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
            default: connection.videoOrientation = .portrait
            }
        }
        CATransaction.commit()
    }

    private func normalizedRect(_ value: Any?) -> CGRect? {
        guard let rect = value as? [String: Double], let x = rect["x"], let y = rect["y"],
              let width = rect["width"], let height = rect["height"],
              [x, y, width, height].allSatisfy({ $0.isFinite }), width > 0, height > 0 else { return nil }
        return CGRect(x: x, y: y, width: width, height: height)
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let current = session, current.output === output, current.lifetime.shouldRun,
              let g = normalizedRect(current.geometry["guide"]) else { return }
        let size = current.view.bounds.size
        let guide = CGRect(x: g.minX * size.width, y: g.minY * size.height, width: g.width * size.width, height: g.height * size.height)
        let candidates = metadataObjects.compactMap { current.preview.transformedMetadataObject(for: $0) as? AVMetadataMachineReadableCodeObject }
            .filter { $0.stringValue != nil && guide.contains(CGPoint(x: $0.bounds.midX, y: $0.bounds.midY)) }
        let nearest = candidates.min {
            hypot($0.bounds.midX - guide.midX, $0.bounds.midY - guide.midY) < hypot($1.bounds.midX - guide.midX, $1.bounds.midY - guide.midY)
        }
        guard let text = nearest?.stringValue else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if text != current.lastText || now - current.lastResultTime >= 0.5 {
            current.lastText = text
            current.lastResultTime = now
            send(current, event: ["type": "result", "text": text])
        }
    }

    static func eventScript(_ event: [String: Any]) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: event), let json = String(data: data, encoding: .utf8) else { return nil }
        return "window.onNativeQRScannerEvent && window.onNativeQRScannerEvent(\(json));"
    }

    private func send(_ current: Session, event: [String: Any]) {
        guard session === current else { return }
        var message = event
        message["sessionId"] = current.id
        if let script = Self.eventScript(message) { webView?.evaluateJavaScript(script) }
    }

    private func fail(_ current: Session, code: String) {
        guard session === current else { return }
        send(current, event: ["type": "error", "code": code])
        stop()
    }

    func stop() {
        guard let current = session else { return }
        session = nil
        current.lifetime.cancel()
        current.observers.forEach { NotificationCenter.default.removeObserver($0) }
        current.observers.removeAll()
        current.view.removeFromSuperview()
        if let appearance = appearance {
            webView?.isOpaque = appearance.opaque
            webView?.backgroundColor = appearance.background
            webView?.scrollView.backgroundColor = appearance.scrollBackground
        }
        appearance = nil
        captureQueue.async {
            current.output.setMetadataObjectsDelegate(nil, queue: nil)
            current.capture.stopRunning()
        }
    }

    @objc private func suspend() {
        guard let current = session else { return }
        current.lifetime.setForeground(false)
        captureQueue.async {
            if let device = current.device, device.hasTorch, (try? device.lockForConfiguration()) != nil {
                device.torchMode = .off
                device.unlockForConfiguration()
            }
            current.capture.stopRunning()
        }
    }

    @objc private func resume() {
        guard let current = session else { return }
        guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
            // The initial permission prompt can dismiss before its completion callback.
            if AVCaptureDevice.authorizationStatus(for: .video) != .notDetermined { fail(current, code: "permissionDenied") }
            return
        }
        current.lifetime.setForeground(true)
        startCapture(current)
    }
}
