/**
 * Copyright 2024 Shift Crypto AG
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { AppContext } from '@/contexts/AppContext';
import { Status } from '@/components/status/status';

export const Testing = () => {
  const { t } = useTranslation();
  const { isTesting } = useContext(AppContext);

  if (!isTesting) {
    return null;
  }

  return (
    <Status type="warning">
      {t('warning.testnet')}
    </Status>
  );
};
