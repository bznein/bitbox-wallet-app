// SPDX-License-Identifier: Apache-2.0

import { useTranslation } from 'react-i18next';
import { SettingsItem } from '@/routes/settings/components/settingsItem/settingsItem';
import { alertUser } from '@/components/alert/Alert';
import { exportLogs } from '@/api/backend';

type TProps = {
  description?: string;
  onExport?: typeof exportLogs;
  title?: string;
};

export const ExportLogSetting = ({
  description,
  onExport = exportLogs,
  title,
}: TProps) => {
  const { t } = useTranslation();
  return (
    <SettingsItem
      settingName={title ?? t('settings.expert.exportLogs.title')}
      onClick={async () => {
        try {
          const result = await onExport();
          if (result !== null && !result.success) {
            alertUser(result.errorMessage || t('genericError'));
          }
        } catch (err) {
          console.error(err);
        }
      }}
      secondaryText={description ?? t('settings.expert.exportLogs.description')}
    />
  );
};
