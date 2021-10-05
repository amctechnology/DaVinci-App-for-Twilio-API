import { Injectable } from '@angular/core';
import {
  Logger,
  initializeComplete,
  registerOnPresenceChanged,
  getConfig,
  setPresence,
  getPresence,
  logout,
  registerOnLogout,
  registerContextualControls,
  addContextualContacts,
  getUserDetails,
  sendNotification,
  enableClickToDial,
  registerClickToDial
} from '@amc-technology/davinci-api';
import { TwilioService } from './twilio.service';
import { ConfigurationService } from './configuration.service';
import { ReplaySubject } from 'rxjs';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class AmcService {
  public config$ = new ReplaySubject<{
    logger: Logger;
    conferenceStatusCallback: string;
    iconPack: string;
    username: string;
  }>(1);

  private logger: Logger;
  private currentWorkmode: string; // Current workmode from twilio sent to Framework
  private initialActivity: string;
  private firstLogin = true;
  private workmodeMap: { [workmode: string]: string }; // workmode to activity sid, and activity sid to workmode
  private frameworkPresenceToTwilio: string; // Framework presence to twilio
  private appTitle: any;

  constructor(
    private twilio: TwilioService,
    private configService: ConfigurationService,
    private loggerService: LoggerService
  ) {
    this.appTitle = null;
    this.initialize();
  }

  async initialize() {
    const serverConfig = await this.configService.loadConfigurationData();
    const davinciConfig = await getConfig();
    this.appTitle = davinciConfig.name;
    const conferenceStatusCallback = davinciConfig.variables
      .ConferenceStatusCallback as string;
    this.initialActivity = davinciConfig.variables.InitialActivity as string;

    this.workmodeMap = (davinciConfig.variables.WorkMode as unknown) as {
      [workmode: string]: string;
    };
    // make the map 2 directional
    for (const key of Object.keys(this.workmodeMap)) {
      this.workmodeMap[this.workmodeMap[key]] = key;
    }

    registerContextualControls(async (contact) => {
      await this.twilio.initiateOutbound(contact.displayName);
    });

    enableClickToDial(true)
      .then(function () {
        this.loggerService.logger.logInformation('click to dial eanbled');
      })
      .catch((e) =>
        this.loggerService.logger.logError(
          `enableClickToDial: ${JSON.stringify(e)}`
        )
      );

    registerClickToDial(async (phoneNumber) => {
      try {
        this.loggerService.logger.logInformation('called clickToDialCallback');

        await this.twilio.initiateOutbound(phoneNumber);

        this.loggerService.logger.logInformation(
          'completed clickToDialCallback'
        );
      } catch (e) {
        this.loggerService.logger.logError(
          `clickToDialCallback: ${JSON.stringify(e)}`
        );
      }
    }).catch((e) =>
      this.loggerService.logger.logError(
        `registerClickToDial: ${JSON.stringify(e)}`
      )
    );

    registerOnPresenceChanged(async (presence, reason, initiatingApp) => {
      if (initiatingApp !== this.appTitle) {
        if (
          this.currentWorkmode !== presence &&
          this.frameworkPresenceToTwilio !== presence
        ) {
          if (this.workmodeMap[presence]) {
            this.loggerService.logger.logDebug(
              'setActivity: ' + this.workmodeMap[presence]
            );
            this.twilio.setActivity(this.workmodeMap[presence]);
            this.frameworkPresenceToTwilio = presence;
          }
        } else {
          setPresence(presence, reason);
        }
      }
    });

    registerOnLogout(async (reason) => {
      this.twilio.setActivity(this.workmodeMap.Logout);
    });

    await initializeComplete(this.loggerService.logger);
    addContextualContacts([]);
    const userDetails = await getUserDetails();
    const username = userDetails.username
      .replace(/[@]/g, '_at_')
      .replace(/\./g, '_dot_');
    this.config$.next({
      logger: this.loggerService.logger,
      conferenceStatusCallback,
      iconPack: serverConfig.iconPack,
      username
    });

    this.twilio.getActivity().subscribe((activitySid) => {
      try {
        const workmode = this.workmodeMap[activitySid];
        if (workmode !== this.currentWorkmode) {
          if (workmode !== "Logout") {
            try {
              this.loggerService.logger.logDebug('setPresence: ' + workmode);
              this.currentWorkmode = workmode;
              setPresence(workmode);
            } catch (e) {
              this.loggerService.logger.logError(e);
              sendNotification('Failed to set to ' + workmode + ' state.', 2);
            }
          } else {
            getPresence().then((result) => {
              if (result.presence !== 'Pending') {
                try {
                  this.loggerService.logger.logDebug('logging out');
                  logout();
                } catch (e) {
                  this.loggerService.logger.logError(e);
                  sendNotification('Logout failed. Please try again.');
                }
              } else {
                try {
                  this.currentWorkmode = this.workmodeMap[this.initialActivity];
                  setPresence(this.currentWorkmode);
                  this.twilio.setActivity(this.initialActivity);
                  this.firstLogin = false;
                  this.loggerService.logger.logDebug('setting initial activity');
                } catch (e) {
                  this.loggerService.logger.logError(e);
                  sendNotification('Login failed. Please try again.', 2);
                }
              }
            });
          }
        }
      } catch (error) {
        this.loggerService.logger.logError(
          `TWILIO - amc.service - getActivity : ${JSON.stringify(error)}`
        )
      }
    });

    this.loggerService.logger.logDebug('[END] Loading app');
  }
}
