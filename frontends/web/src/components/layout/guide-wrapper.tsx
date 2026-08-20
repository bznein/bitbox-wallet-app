// SPDX-License-Identifier: Apache-2.0

import { ReactNode } from 'react';
import styles from './guide-wrapper.module.css';

type TProps = {
  children: ReactNode;
};

type TGuideWrapperProps = TProps & {
  className?: string;
};

export const GuideWrapper = ({ children, className = '' }: TGuideWrapperProps) => {
  return (
    <div className={`${styles.contentWithGuide || ''} ${className}`}>
      {children}
    </div>
  );
};

export const GuidedContent = ({ children }: TProps) => {
  return (
    <div className={styles.container}>
      {children}
    </div>
  );
};
