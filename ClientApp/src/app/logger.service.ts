import { Injectable } from '@angular/core';
import { Logger } from '@amc-technology/davinci-api';
import { ConfigurationService } from './configuration.service';

@Injectable()
export class LoggerService {
  public logger: Logger;
  constructor(private configService: ConfigurationService) {
    this.initialize();
  }

  async initialize() {
    const serverConfig = await this.configService.loadConfigurationData();
    this.logger = new Logger(
      'DaVinciContactCenter',
      serverConfig.useDevLogger === 'true',
      serverConfig.apiUrl
    );
    this.logger.logDebug('[START] Loading app');
  }
}
