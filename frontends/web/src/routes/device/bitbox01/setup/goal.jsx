/**
 * Copyright 2018 Shift Devices AG
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

import { Component } from 'react';
import { withTranslation } from 'react-i18next';
import { Button } from '../../../../components/forms';
import { SwissMadeOpenSource, SwissMadeOpenSourceDark } from '../../../../components/icon/logo';
import { Header } from '../../../../components/layout';
import { LanguageSwitch } from '../../../../components/language/language';
import { getDarkmode } from '../../../../components/darkmode/darkmode';

class Goal extends Component {
  render() {
    const {
      t,
      onCreate,
      onRestore,
    } = this.props;
    return (
      <div className="contentWithGuide">
        <div className="container">
          <Header title={<h2>{t('welcome.title')}</h2>}>
            <LanguageSwitch />
          </Header>
          <div className="innerContainer">
            <div className="content padded narrow isVerticallyCentered">
              <div className="box large">
                <p className="first">{t('goal.paragraph')}</p>
                <div className="buttons">
                  <Button primary onClick={onCreate}>
                    {t('goal.buttons.create')}
                  </Button>
                  <Button secondary onClick={onRestore}>
                    {t('goal.buttons.restore')}
                  </Button>
                </div>
              </div>
              <div className="text-center m-top-large">
                {getDarkmode() ? <SwissMadeOpenSourceDark /> : <SwissMadeOpenSource />}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}

export default withTranslation()(Goal);
