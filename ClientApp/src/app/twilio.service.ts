import { async } from '@angular/core/testing';
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, ReplaySubject, from } from 'rxjs';
import {
  ITwilioInteraction,
  IConnection,
  IReservation,
  CHANNELS,
  CONNECTION_DIRECTION
} from './model/TwilioInteraction';
import { Device } from 'twilio-client';
import * as TwilioChat from 'twilio-chat';
import {
  setInteraction,
  InteractionDirectionTypes,
  RecordItem,
  InteractionStates,
  ChannelTypes,
  getConfig,
  sendNotification,
  contextualOperation,
  ContextualOperationType,
  getUserDetails,
  Field
} from '@amc-technology/davinci-api';
import { LoggerService } from './logger.service';
import sha256 from 'crypto-js/sha256';
import Base64 from 'crypto-js/enc-base64';
import { StorageService } from './twilioStorage.service';
import { takeWhile } from 'rxjs/operators';
import { ConnectedOverlayPositionChange } from '@angular/cdk/overlay';

// eslint-disable-next-line @typescript-eslint/naming-convention
declare const Twilio: { TaskRouter: any };

@Injectable({
  providedIn: 'root'
})
export class TwilioService {
  private worker: any;
  private devices: Device = new Array<Device>(5);
  private voiceToken: any;
  private twilioInteractions: {
    [taskSid: string]: {
      interaction: ITwilioInteraction;
      subject: BehaviorSubject<ITwilioInteraction>;
    };
  } = {};

  private tasks$ = new ReplaySubject<BehaviorSubject<ITwilioInteraction>>(10);
  private activity$ = new ReplaySubject<string>(1);
  private currentActivity: string;
  private chatClient: TwilioChat.Client;
  private username: string;
  private accountSid: any;
  private authToken: any;
  private workSpaceSid: any;
  private directWorkflowSid: any;
  private chatServiceSid: any;
  private chatApiSid: any;
  private chatApiSecret: any;
  private voiceApplicationSid: any;
  private outboundNumber: string;
  private holdOnTransfer = true;
  private statusCallback: any;
  private incomingPhoneRinger: any;
  private incomingChatSMSRinger: any;
  private devicesInitialized = false;
  private conferenceFriendlyName: string;
  private outboundTo: string;
  private workmodeMap: { [workmode: string]: string }; // workmode to activity sid, and activity sid to workmode
  private previousActivity: string;
  public userEnabledSound = false;
  public isChrome = false;
  private cadKeyDisplayMapping: any;

  constructor(
    private http: HttpClient,
    private loggerService: LoggerService,
    private storageService: StorageService
  ) {
    this.cadKeyDisplayMapping = null;
    this.initialize();
    this.reservationRemoved = this.reservationRemoved.bind(this);
    this.reservationCreated = this.reservationCreated.bind(this);
    this.reservationAccepted = this.reservationAccepted.bind(this);
  }

  async initialize() {
    try {
      this.storageService.syncWithLocalStorage();
      const davinciConfig = await getConfig();
      const userDetails = await getUserDetails();
      this.username = userDetails.username
        .replace(/[@]/g, '_at_')
        .replace(/\./g, '_dot_');
      await this.getDavinciConfigs(davinciConfig);
      await this.getTokens();
    } catch (error) {
      this.loggerService.logger.logError('Unable to initialize: ' + error);
    }
  }

  public async getDavinciConfigs(davinciConfig: any) {
    // General Configs
    this.accountSid = davinciConfig.variables.AccountSid;
    this.authToken = davinciConfig.variables.AuthToken;
    this.workSpaceSid = davinciConfig.variables.WorkSpaceSid;
    this.directWorkflowSid = davinciConfig.variables.DirectWorkflowSid;
    // Phone Configs
    this.voiceApplicationSid =
      davinciConfig['Phone'].variables['VoiceApplicationSid'];
    this.statusCallback = davinciConfig.variables.ConferenceStatusCallback;
    this.outboundNumber = davinciConfig['Phone'].variables['OutboundNumber'];
    if (davinciConfig['Phone'].variables.hasOwnProperty('HoldOnTransfer')) {
      this.holdOnTransfer = davinciConfig['Phone'].variables['HoldOnTransfer'];
    }
    if (davinciConfig['Phone'].variables.hasOwnProperty('TelephonyRinger')) {
      this.incomingPhoneRinger = new Audio(
        davinciConfig['Phone'].variables['TelephonyRinger']
      );
      this.incomingPhoneRinger.loop = true;
      if (this.incomingPhoneRinger && !this.incomingPhoneRinger.paused) {
        this.incomingPhoneRinger.pause();
      }
    }
    this.workmodeMap = (davinciConfig.variables.WorkMode as unknown) as {
      [workmode: string]: string;
    };
    // Chat and SMS Configs
    if (
      davinciConfig.CADDisplay &&
      davinciConfig.CADDisplay.variables &&
      davinciConfig.CADDisplay.variables['DisplayKeyList']
    ) {
      this.cadKeyDisplayMapping =
        davinciConfig.CADDisplay.variables['DisplayKeyList'];
    }
    this.chatServiceSid = davinciConfig['ChatSMS'].variables['ChatServiceSid'];
    this.chatApiSid = davinciConfig['ChatSMS'].variables['ChatApiSid'];
    this.chatApiSecret = davinciConfig['ChatSMS'].variables['ChatApiSecret'];
    if (davinciConfig['ChatSMS'].variables.hasOwnProperty('ChatSMSRinger')) {
      this.incomingChatSMSRinger = new Audio(
        davinciConfig['ChatSMS'].variables['ChatSMSRinger']
      );
      this.incomingChatSMSRinger.loop = true;
      if (this.incomingChatSMSRinger && !this.incomingChatSMSRinger.paused) {
        this.incomingChatSMSRinger.pause();
      }
    }
  }

  public async getTokens() {
    try {
      this.http
        .post<ICapabilityTokens>('CapabilityToken', {
          AccountSid: this.accountSid,
          AuthToken: this.authToken,
          WorkspaceSid: this.workSpaceSid,
          DirectWorkFlowSid: this.directWorkflowSid,
          ChatServiceSid: this.chatServiceSid,
          ChatApiSid: this.chatApiSid,
          ChatApiSecret: this.chatApiSecret,
          VoiceApplicationSid: this.voiceApplicationSid
        })
        .subscribe(
          async (response) => {
            this.worker = await new Twilio.TaskRouter.Worker(
              response.taskRouterToken
            );
            this.voiceToken = response.voiceToken;
            await this.addDevices();
            await this.createTaskRouterListeners();
            if (
              this.chatApiSecret !== '' &&
              this.chatApiSid !== '' &&
              this.chatServiceSid !== ''
            ) {
              this.chatClient = await TwilioChat.Client.create(
                response.chatToken
              );
              await this.createChatListeners();
            }

            if (!this.currentActivity) {
              this.activity$.next(response.startingActivitySid);
            }
          },
          (error) => {
            this.loggerService.logger.logError(
              'Failed to refresh Twilio tokens.'
            );
          }
        );
    } catch (error) {
      this.loggerService.logger.logError('Unable to get tokens: ' + error);
    }
  }

  public async refreshTokens() {
    try {
      this.http
        .post<ICapabilityTokens>('CapabilityToken', {
          AccountSid: this.accountSid,
          AuthToken: this.authToken,
          WorkspaceSid: this.workSpaceSid,
          DirectWorkFlowSid: this.directWorkflowSid,
          ChatServiceSid: this.chatServiceSid,
          ChatApiSid: this.chatApiSid,
          ChatApiSecret: this.chatApiSecret,
          VoiceApplicationSid: this.voiceApplicationSid
        })
        .subscribe(async (response) => {
          this.worker = await new Twilio.TaskRouter.Worker(
            response.taskRouterToken
          );
          this.voiceToken = response.voiceToken;
          this.refreshOfflineDevices();
        });
    } catch (error) {
      this.loggerService.logger.logError('Failed to refresh tokens: ' + error);
    }
  }

  public async addDevices() {
    for (let device of this.devices) {
      if (device !== undefined && device.status() !== 'busy') {
        device = undefined; // makes all device null
      }
    }
    // Initializes all of the devices for handling calls
    for (let i = 0; i < this.devices.length; i++) {
      // Iterates over the array of devices and creates devices
      if (this.devices[i] === undefined) {
        try {
          this.devices[i] = await new Device(this.voiceToken, {
            codecPreferences: ['opus', 'pcmu']
          });
        } catch (error) {
          this.loggerService.logger.logError(
            'Failed to create device number ' + i + '. ' + error
          );
        }
        await this.createVoiceListeners(i);
      }
    }
    this.devicesInitialized = true;
  }

  public async checkDevices(state: string) {
    for (const device of this.devices) {
      // Check if there are any devices in the given state
      if (device.status() === state) {
        return true;
      }
    }
    return false;
  }

  public async holdDevices() {
    try {
      for (const device of this.devices) {
        // Check if all devices are busy
        if (device.status() === 'busy') {
          // If the device is busy it gets put on hold when making an outbound call
          const twilioObject = await this.getTwilioInteractionByConnection(
            device.activeConnection()
          );
          if (!twilioObject.interaction.isHeld) {
            await this.hold(twilioObject.interaction, true);
          }
        }
      }
    } catch (error) {
      this.loggerService.logger.logError('Unable to hold devices: ' + error);
    }
  }

  public async refreshOfflineDevices() {
    for (let i = 0; i < this.devices.length; i++) {
      if (this.devices[i].status() === 'offline') {
        try {
          this.devices[i].setup(this.voiceToken, {
            codecPreferences: ['opus', 'pcmu']
          });
        } catch (error) {
          this.loggerService.logger.logError(
            'Failed to create device number ' + i + '. ' + error
          );
        }
      }
    }
  }

  public getTasks() {
    return this.tasks$.asObservable();
  }

  public getActivity() {
    return this.activity$.asObservable();
  }

  public setActivity(activitySid: string): Promise<void> {
    try {
      if (activitySid === this.currentActivity) {
        return Promise.resolve();
      }
      return new Promise(async (resolve, reject) => {
        await this.worker.update(
          'ActivitySid',
          activitySid,
          (error, worker) => {
            if (error) {
              this.loggerService.logger.logError(error.code);
              this.loggerService.logger.logError(error.message);
              sendNotification(error.message, 2);
              sendNotification('Failed to update activity.', 2);
              reject(error);
            } else {
              resolve();
            }
          }
        );
      });
    } catch (e) {
      sendNotification('Unable to change activity.', 2);
      this.loggerService.logger.logError('Unable to set activity: ' + e);
    }
  }

  public wrapup(twilioInteraction: ITwilioInteraction, isWrapup: boolean) {
    try {
      twilioInteraction.isWrapup = isWrapup;

      if (twilioInteraction.taskSid != null) {
        this.nextTwilioInteraction(
          this.twilioInteractions[twilioInteraction.taskSid]
        );
        this.wrapUpTask(twilioInteraction.taskSid);
      } else {
        this.nextTwilioInteraction(
          this.twilioInteractions[twilioInteraction.reservation.taskSid]
        );
        this.wrapUpTask(twilioInteraction.reservation.taskSid);
      }
      twilioInteraction.parties = [];
      if (this.previousActivity === 'Not Ready') {
        this.setActivity(this.workmodeMap['Not Ready']);
        this.previousActivity = null;
      }
    } catch (error) {
      this.loggerService.logger.logError('Error in wrapup operation: ' + error);
    }
  }

  public deleteTwilioInteraction(sid: string) {
    try {
      const twilioInteraction = this.twilioInteractions[sid];
      if (twilioInteraction) {
        twilioInteraction.subject.complete();
        delete this.twilioInteractions[sid];
        setInteraction({
          state: InteractionStates.Disconnected,
          interactionId: sid,
          scenarioId: sid,
          direction: twilioInteraction.interaction.reservation
            ? InteractionDirectionTypes.Inbound
            : InteractionDirectionTypes.Outbound,
          userFocus: false
        });
        if (
          this.storageService.onFocusTaskId &&
          this.storageService.onFocusTaskId === sid
        ) {
          const taskKeys = Object.keys(this.twilioInteractions);
          if (taskKeys.length > 0) {
            this.storageService.setOnFocus(taskKeys[0]);
          } else {
            this.storageService.setOnFocus('');
          }
        }
      }
    } catch (error) {
      this.loggerService.logger.logError(
        'Unable to delete interaction: ' + error
      );
    }
  }

  private async getTwilioInteractionByConnection(connection: IConnection) {
    try {
      /*
    TODO: find a better way to link connection and task
    With the current method you can only have 1 call from a twilio number
      e.g. cant have 2 customers that called the same queue number
    */
      // Search for matching inbound call
      const from = connection.parameters.From;
      let result = Object.values(this.twilioInteractions)
        .filter((el) => el.interaction.reservation)
        .find(
          (el) =>
            from === el.interaction.reservation.task.attributes.from ||
            from === el.interaction.reservation.task.attributes.to
        );

      // Search for matching outbound call
      if (!result) {
        result = this.twilioInteractions[connection.parameters.CallSid];
      }
      if (!result) {
        result = this.getTwilioInteractionByTaskSid(
          connection.parameters.TaskSid
        );
      }
      if (!result) {
        // This checks all of the calls stored in parties of each task
        const interactions = Object.values(this.twilioInteractions);
        for (let i = 0; i < interactions.length; i++) {
          const parties =
            interactions[i].interaction.reservation.task.attributes.parties;
          for (let j = 0; j < parties.length; j++) {
            const call = await this.http
              .post('GetCaller', {
                AccountSid: this.accountSid,
                AuthToken: this.authToken,
                CallSid: parties[j]
              })
              .toPromise();
            if (call['call']['from'] === from || call['call']['to'] === from) {
              result = interactions[i];
              break;
            }
          }
        }
      }
      return result;
    } catch (error) {
      this.loggerService.logger.logError(
        'Unable to get Interaction from Connection' + error
      );
    }
  }

  private getTwilioInteractionByTaskSid(taskSid: string) {
    try {
      let interaction = this.twilioInteractions[taskSid];
      if (!interaction) {
        interaction = Object.values(this.twilioInteractions).find(
          (el) =>
            el.interaction.reservation &&
            el.interaction.reservation.taskSid === taskSid
        );
      }
      return interaction;
    } catch (error) {
      this.loggerService.logger.logError(
        'Unable to get interaction from TaskSid' + error
      );
    }
  }

  private async nextTwilioInteraction(interaction: {
    interaction: ITwilioInteraction;
    subject: BehaviorSubject<ITwilioInteraction>;
  }) {
    if (interaction) {
      await this.updateParties(interaction.interaction);
      await interaction.subject.next(interaction.interaction);
    }
  }

  private getTwilioInteractionByChannelSid(channelSid: string) {
    let interaction = this.twilioInteractions[channelSid];
    if (!interaction) {
      interaction = Object.values(this.twilioInteractions).find(
        (element) =>
          element.interaction.reservation &&
          element.interaction.reservation.task.attributes.channelSid ===
            channelSid
      );
    }
    return interaction;
  }

  private addTwilioInteraction(interaction: ITwilioInteraction) {
    const twilioObject = {
      interaction,
      subject: new BehaviorSubject<ITwilioInteraction>(interaction)
    };
    this.twilioInteractions[interaction.taskSid] = twilioObject;
    if (!this.storageService.onFocusTaskId) {
      this.storageService.setOnFocus(interaction.taskSid);
    }
    this.tasks$.next(twilioObject.subject);
    return twilioObject;
  }

  public async setTimeoutAsPromise(timeout: number): Promise<void> {
    return new Promise((accept, reject) => {
      window.setTimeout(() => accept(), timeout);
    });
  }

  /** ***********************************************************
    Task Router
  /*************************************************************/
  private async createTaskRouterListeners() {
    this.worker.on('token.expired', async () => {
      this.refreshTokens();
    });

    this.worker.on('reservation.rejected', this.reservationRemoved);
    this.worker.on('reservation.timeout', this.reservationRemoved);
    this.worker.on('reservation.canceled', this.reservationRemoved);
    this.worker.on('reservation.rescinded', this.reservationRemoved);
    this.worker.on('reservation.created', this.reservationCreated);
    this.worker.on('reservation.accepted', this.reservationAccepted);
    this.worker.on('activity.update', (worker) => {
      this.currentActivity = worker.activitySid;
      this.activity$.next(worker.activitySid);
    });
    this.worker.on('task.updated', async (task) => {
      await this.nextTwilioInteraction(
        await this.getTwilioInteractionByTaskSid(task.sid)
      );
    });

    this.worker.fetchReservations((error, reservations) => {
      if (!error) {
        reservations.data
          .filter(
            (reservation) => reservation.task.assignmentStatus !== 'completed'
          )
          .forEach((reservation) => this.reservationCreated(reservation));
      } else {
        this.loggerService.logger.logError(error);
        sendNotification('Failed to create task router listener.', 2);
      }
    });
  }

  private async reservationCreated(reservation: IReservation) {
    if (reservation.reservationStatus === 'pending') {
      const devicesBusy = await this.checkDevices('busy');
      if (!!reservation.task.attributes['outbound'] === true) {
        if (JSON.parse(reservation.task.attributes['outbound']) === true) {
          await this.acceptOutbound(reservation);
        }
        if (
          reservation.task.attributes['parties'] &&
          reservation.task.attributes['parties'].length === 0
        ) {
          this.worker.completeTask(
            // This cleans up tasks that were never properly
            reservation.taskSid,
            (error, completedTask) => {}
          );
        }
      } else if (!devicesBusy) {
        // If there are no busy devices we can recieve a call
        if (reservation.task.attributes.type === 'phone') {
          this.phoneReservationCreated(reservation);
        } else if (reservation.task.attributes.type === 'sms') {
          this.smsReservationCreated(reservation);
        } else if (reservation.task.attributes.type === 'Chat') {
          this.chatReservationCreated(reservation);
        }
      } else {
        // If there is a busy device we reject the reservation and it goes back to the queue
        reservation.reject();
      }
    } else if (reservation.reservationStatus === 'wrapping') {
      let channel = CHANNELS.Phone;
      if (reservation['task']['attributes']['type'] && reservation['task']['attributes']['type'] === 'sms') {
        channel = CHANNELS.SMS;
      } else if (reservation['task']['attributes']['type'] && reservation['task']['attributes']['type'] === 'chat') {
        channel = CHANNELS.Chat;
      }
      const interaction = {
        channel: channel,
        taskSid: reservation.taskSid,
        reservation,
        parties: [],
        connection: null,
        isHeld: false,
        isBlindTransfering: false,
        isWarmTransfering: false,
        isWrapup: true
      };
      await this.addTwilioInteraction(interaction);
    } else {
      await this.resetConnection(reservation);
    }
  }

  private reservationAccepted(reservation: IReservation) {
    if (!!reservation.task.attributes['outbound'] === true) {
      if (JSON.parse(reservation.task.attributes['outbound']) === true) {
        const twilioObject = this.getTwilioInteractionByTaskSid(
          reservation.task.sid
        );
        twilioObject.interaction.reservation = reservation;
      }
    } else {
      this.nextTwilioInteraction(
        this.getTwilioInteractionByTaskSid(reservation.taskSid)
      );
      setInteraction({
        state: InteractionStates.Connected,
        interactionId: reservation.taskSid,
        scenarioId: reservation.taskSid,
        direction: InteractionDirectionTypes.Inbound, // TODO: make this dependant on the calls direction
        userFocus: this.storageService.onFocusTaskId === reservation.taskSid
      });
      if (this.incomingPhoneRinger && !this.incomingPhoneRinger.paused) {
        this.incomingPhoneRinger.pause();
      }
      if (this.incomingChatSMSRinger && !this.incomingChatSMSRinger.paused) {
        this.incomingChatSMSRinger.pause();
      }
    }
  }

  private reservationRemoved(reservation: IReservation) {
    if (this.incomingPhoneRinger && !this.incomingPhoneRinger.paused) {
      this.incomingPhoneRinger.pause();
    }
    if (this.incomingChatSMSRinger && !this.incomingChatSMSRinger.paused) {
      this.incomingChatSMSRinger.pause();
    }
    this.deleteTwilioInteraction(reservation.taskSid);
  }

  public async completeTask(taskSid: string) {
    await this.http
      .post('completeTask', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        WorkSpaceSid: this.workSpaceSid,
        TaskSid: taskSid,
        Reason: 'Task Completed'
      })
      .subscribe(async (response) => {});
  }

  public async wrapUpTask(taskSid: string) {
    await this.http
      .post('wrapUpTask', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        WorkSpaceSid: this.workSpaceSid,
        TaskSid: taskSid,
        Reason: 'Call Ended'
      })
      .subscribe(async (response) => {});
  }

  /** ***********************************************************
    Phone
  /*************************************************************/
  private async createVoiceListeners(deviceIndex: number) {
    this.devices[deviceIndex].on('ready', (device) => {});
    this.devices[deviceIndex].on('error', (error) => {
      this.loggerService.logger.logError(error.message);
      if (error.message !== 'JWT Token Expired') {
        sendNotification('Failed to create voice listener.', 2);
      }
    });
    this.devices[deviceIndex].on('connect', async (connection) => {
      await connection.on('mute', async () => {
        await this.nextTwilioInteraction(
          await this.getTwilioInteractionByConnection(connection)
        );
      });
      await this.setConnection(connection);
    });
    this.devices[deviceIndex].on('disconnect', async (connection) => {
      const twilioObject = await this.getTwilioInteractionByConnection(
        connection
      );
      if (twilioObject.interaction.channel === 'Phone') {
        this.wrapup(twilioObject.interaction, true);
      }
      if (twilioObject.interaction.channel !== 'Phone') {
        this.deleteTwilioInteraction(twilioObject.interaction.taskSid);
      }
    });

    this.devices[deviceIndex].on('offline', async (device) => {
      await this.refreshTokens();
    });

    if (deviceIndex === 0) {
      // Only the first device is listening for incoming calls
      this.devices[0].on('incoming', async (connection) => {
        await this.setConnection(connection);
        connection.accept();
      });
    }
  }

  private async setConnection(connection: any, reservation?: IReservation) {
    let twilioObject = await this.getTwilioInteractionByConnection(connection);
    if (!twilioObject) {
      // const task = await this.createOutboundTask(this.conferenceFriendlyName, this.outboundTo);
      connection.parameters.From = this.outboundTo;
      connection.parameters.TaskSid = reservation.task.sid;
      const interaction = {
        channel: CHANNELS.Phone,
        connection,
        taskSid: reservation.task.sid,
        parties: [],
        reservation: reservation,
        isHeld: false,
        isBlindTransfering: false,
        isWarmTransfering: false
      };
      twilioObject = this.addTwilioInteraction(interaction);

      const details = new RecordItem('', '', '');
      details.setPhone('', '', connection.message.phone);
      setInteraction({
        channelType: ChannelTypes.Telephony,
        state: InteractionStates.Alerting,
        interactionId: twilioObject.interaction.taskSid,
        scenarioId: twilioObject.interaction.taskSid,
        direction: InteractionDirectionTypes.Outbound,
        details,
        userFocus:
          this.storageService.onFocusTaskId === twilioObject.interaction.taskSid
      });
    } else {
      twilioObject.interaction.connection = connection;
    }
    this.nextTwilioInteraction(twilioObject);
  }

  private async resetConnection(reservation: IReservation) {
    let channel;
    let channelType;
    if (reservation.task.attributes['channel'] === 'phone') {
      channel = CHANNELS.Phone;
      channelType = ChannelTypes.Telephony;
    } else if (reservation.task.attributes['channel'] === 'chat') {
      channel = CHANNELS.Chat;
      channelType = ChannelTypes.Chat;
    } else {
      channel = CHANNELS.SMS;
      channelType = ChannelTypes.SMS;
    }

    let connectionDirection;
    let direction;
    if (reservation.task.attributes['outbound'] && reservation.task.attributes['outbound'].toString() === 'true') {
      connectionDirection = CONNECTION_DIRECTION.OUTBOUND;
      direction = InteractionDirectionTypes.Outbound;
    } else {
      connectionDirection = CONNECTION_DIRECTION.INCOMING;
      direction = InteractionDirectionTypes.Inbound;
    }

    const connection: IConnection = {
      direction: connectionDirection,
      parameters: {
        AccountSid: this.accountSid,
        CallSid: reservation.task.attributes['conference']['sid'],
        TaskSid: reservation.task.sid,
        From: reservation.task.attributes['from'],
        To: reservation.task.attributes['to'],
        customParameters: null
      }
    };

    const interaction = {
      channel: channel,
      connection,
      taskSid: reservation.task.sid,
      parties: [],
      reservation: reservation,
      isHeld: false,
      isBlindTransfering: false,
      isWarmTransfering: false,
      isWrapup: true
    };
    const twilioObject = this.addTwilioInteraction(interaction);

    const details = new RecordItem('', '', '');
    setInteraction({
      channelType: channelType,
      state: InteractionStates.Disconnected,
      interactionId: twilioObject.interaction.taskSid,
      scenarioId: twilioObject.interaction.taskSid,
      direction: direction,
      details,
      userFocus:
        this.storageService.onFocusTaskId === twilioObject.interaction.taskSid
    });
    this.nextTwilioInteraction(twilioObject);
    await this.wrapup(interaction, true);
  }

  public async createOutboundTask(conferenceName: string, to: string) {
    const task = await this.http
      .post('OutboundTask', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        WorkflowSid: this.directWorkflowSid,
        WorkSpaceSid: this.workSpaceSid,
        to: to,
        from: this.username,
        OutboundNumber: this.outboundNumber,
        FriendlyName: conferenceName,
        ConferenceSid: ''
      })
      .toPromise();
    return task['taskSid'];
  }

  private async getConferenceSid(friendlyName: string) {
    try {
      const conference = await this.http
        .post('GetConferenceSid', {
          AccountSid: this.accountSid,
          AuthToken: this.authToken,
          FriendlyName: friendlyName
        })
        .toPromise();
      return conference;
    } catch (e) {
      this.loggerService.logger.logError(e);
    }
  }

  private async phoneReservationCreated(reservation: IReservation) {
    try {
      if (reservation.reservationStatus !== 'canceled') {
        if (reservation.task.attributes['outbound']) {
          // because you can initiate an outbound while on another call we must automatically accept outbound tasks
          if (!this.checkDevices('busy')) {
            await reservation.accept(async (error) => {
              if (error) {
                throw error;
              }
            });
          }
        } else {
          const interaction = {
            channel: CHANNELS.Phone,
            taskSid: reservation.taskSid,
            reservation,
            parties: [],
            connection: null,
            isHeld: false,
            isBlindTransfering: false,
            isWarmTransfering: false
          };
          await this.addTwilioInteraction(interaction);
          const attributes = reservation.task.attributes;
          const fields: { [key: string]: Field } = {};
          for (const key in attributes) {
            if (key != null) {
              const value = attributes[key];
              const field: Field = {
                DevName: key,
                DisplayName: key,
                Value: value
              };
              fields[key] = field;
            }
          }
          const details = new RecordItem('', '', '', fields);
          await details.setPhone(
            'phone',
            'phone',
            reservation.task.attributes.from
          );

          await setInteraction({
            channelType: ChannelTypes.Telephony,
            state: InteractionStates.Alerting,
            interactionId: reservation.taskSid,
            scenarioId: reservation.taskSid,
            direction: InteractionDirectionTypes.Inbound,
            details,
            userFocus: this.storageService.onFocusTaskId === interaction.taskSid
          });
          if (this.incomingPhoneRinger) {
            this.incomingPhoneRinger.play();
          }
        }
      }
    } catch (error) {
      this.loggerService.logger.logError(
        'Error accepting reservation: ' + error
      );
    }
  }

  private async updateParties(twilioInteraction: ITwilioInteraction) {
    try {
      let taskSid = '';
      if (twilioInteraction.taskSid !== null) {
        taskSid = twilioInteraction.taskSid;
      } else {
        taskSid = twilioInteraction.reservation.task.sid;
      }
      let attributes: any;
      if (taskSid !== null) {
        attributes = await this.http
          .post('GetParties', {
            AccountSid: this.accountSid,
            AuthToken: this.authToken,
            WorkspaceSid: this.workSpaceSid,
            TaskSid: taskSid
          })
          .toPromise();
      } else {
        return;
      }
      if (
        JSON.parse(attributes['attributes'])['parties'] != null &&
        twilioInteraction.parties != null &&
        JSON.parse(attributes['attributes'])['parties'].length <
          twilioInteraction.parties.length
      ) {
        twilioInteraction.isWarmTransfering = null;
        twilioInteraction.confirmingWarmTransfer = null;
        twilioInteraction.incomingWarmTransfer = null;
      }
      twilioInteraction.reservation.task.attributes.conference = JSON.parse(
        attributes['attributes']
      )['conference'];
      twilioInteraction.parties = JSON.parse(attributes['attributes'])[
        'parties'
      ];
      if (
        twilioInteraction.parties != null &&
        twilioInteraction.parties.length < 2
      ) {
        let response = await this.http
          .post('GetConferenceSid', {
            AccountSid: this.accountSid,
            AuthToken: this.authToken,
            friendlyName: twilioInteraction.connection['customParameters'].get(
              'friendlyName'
            )
          })
          .toPromise();
        let conferenceSid = response['conferenceSid'];
        if (conferenceSid === undefined) {
          response = await this.http
            .post('GetConferenceFromTask', {
              AccountSid: this.accountSid,
              AuthToken: this.authToken,
              WorkSpaceSid: this.workSpaceSid,
              TaskSid: twilioInteraction.reservation.task.sid
            })
            .toPromise();
          conferenceSid = response['conferenceSid'];
        }
        await this.endConferencOnExit(conferenceSid, true);
      }
    } catch (e) {
      this.loggerService.logger.logError('Failed to update parties. ' + e);
    }
  }

  public async endConferencOnExit(
    conferenceSid: string,
    endConferenceOnExit: boolean
  ) {
    await this.http
      .post('EndConferenceOnExit', {
        accountSid: this.accountSid,
        authToken: this.authToken,
        conferenceSid: conferenceSid,
        endConferenceOnExit: endConferenceOnExit
      })
      .toPromise();
  }

  public async getCallInformation(callSid: string) {
    const call = await this.http
      .post('GetCaller', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        CallSid: callSid
      })
      .toPromise();
    return call['call'];
  }

  public async acceptConference(
    twilioInteraction: ITwilioInteraction,
    from: string
  ) {
    twilioInteraction.reservation.accept(async (error, reservation) => {
      if (error) {
        throw error;
      }
    });
    await this.http
      .post('acceptConference', {
        accountSid: this.accountSid,
        authToken: this.authToken,
        workSpaceSid: this.workSpaceSid,
        taskSid: twilioInteraction.reservation.task.sid,
        conferenceSid:
          twilioInteraction.reservation.task.attributes.conference['sid'],
        workerFriendlyName: 'client:' + this.username,
        from: from
      })
      .toPromise();
    if (this.incomingPhoneRinger && !this.incomingPhoneRinger.paused) {
      this.incomingPhoneRinger.pause();
    }
  }

  public async acceptOutbound(reservation: IReservation) {
    await reservation.accept();
    for (const device of this.devices) {
      // Check for a ready device, if there is one connect to it
      if (device) {
        if (device.status() === 'ready') {
          const friendlyNamePreHash =
            Date.now() + reservation.task.attributes.from;
          const friendlyName256 = sha256(friendlyNamePreHash);
          const friendlyName64 = Base64.stringify(friendlyName256);
          let conferenceSid;
          let attempts = 0;
          this.conferenceFriendlyName = friendlyName64.replace(/\//g, ''); // Removes forward slashes from conferenceName

          const connection = await device.connect({
            friendlyName: this.conferenceFriendlyName,
            phone: reservation.task.attributes.from
          });

          while (conferenceSid === undefined && attempts < 20) {
            await this.setTimeoutAsPromise(500);
            conferenceSid = await this.getConferenceSid(
              this.conferenceFriendlyName
            );
            attempts++;
          }

          await this.http
            .post('AddConferenceSid', {
              AccountSid: this.accountSid,
              AuthToken: this.authToken,
              WorkSpaceSid: this.workSpaceSid,
              TaskSid: reservation.taskSid,
              ConferenceSid: conferenceSid['conferenceSid']
            })
            .toPromise();

          await this.http
            .post('AddConferenceName', {
              AccountSid: this.accountSid,
              AuthToken: this.authToken,
              WorkSpaceSid: this.workSpaceSid,
              TaskSid: reservation.taskSid,
              ConferenceName: this.conferenceFriendlyName
            })
            .toPromise();

          await this.addParty(
            conferenceSid['conferenceSid'],
            reservation.task.attributes.from,
            this.outboundNumber
          );

          await this.setConnection(connection, reservation);
          return;
        }
      }
    }
  }

  /** ***********************************************************
    Chat
  /*************************************************************/
  private createChatListeners() {
    this.chatClient.on('channelInvited', (channel) => {
      // invited to join
    });
    this.chatClient.on('channelAdded', (channel) => {
      // when a channel becomes visible. e.g. when a new public channel is created???
    });
    this.chatClient.on('channelJoined', async (channel) => {
      let twilioInteraction = this.getTwilioInteractionByChannelSid(
        channel.sid
      );
      if (!twilioInteraction) {
        const interaction = {
          taskSid: channel.sid,
          channel: CHANNELS.SMS,
          parties: [],
          chat: {
            channel,
            messages: []
          }
        };
        twilioInteraction = this.addTwilioInteraction(interaction);
      } else {
        twilioInteraction.interaction.chat = {
          channel,
          messages: []
        };
        this.nextTwilioInteraction(twilioInteraction);
      }
      channel.on('messageAdded', (message) => {
        twilioInteraction.interaction.chat.messages.push(message);
        this.nextTwilioInteraction(twilioInteraction);
      });

      let messages = [];
      let messagePaginator = await channel.getMessages();
      messages = messages.concat(messagePaginator.items);
      while (messagePaginator.hasNextPage) {
        messagePaginator = await messagePaginator.nextPage();
        messages = messages.concat(messagePaginator.items);
      }
      if (messages.length > 0) {
        twilioInteraction.interaction.chat.messages.push(...messages);
        this.nextTwilioInteraction(twilioInteraction);
      }
    });
    this.chatClient.on('channelLeft', (channel) => {
      const twilioInteraction = this.getTwilioInteractionByChannelSid(
        channel.sid
      );
      if (twilioInteraction) {
        this.deleteTwilioInteraction(twilioInteraction.interaction.taskSid);
      }
    });
    this.chatClient.on('channelRemoved', (channel) => {
      // fired when a channel is no longer visible
    });
    this.chatClient.on('channelUpdated', (channel) => {
      // fired when attributes/metadata changes
    });
    this.chatClient.on('channelAdded', (channel) => {});
    this.chatClient.on('channelAdded', (channel) => {});
    this.chatClient.on('channelAdded', (channel) => {});
  }

  private smsReservationCreated(reservation: IReservation) {
    let twilioInteraction = this.getTwilioInteractionByChannelSid(
      reservation.task.attributes.channelSid
    );
    if (twilioInteraction) {
      twilioInteraction.interaction.reservation = reservation;
      this.nextTwilioInteraction(twilioInteraction);
    } else {
      const interaction = {
        channel: CHANNELS.SMS,
        taskSid: reservation.taskSid,
        reservation,
        connection: null,
        parties: [],
        isHeld: false,
        isBlindTransfering: false,
        isWarmTransfering: false
      };
      twilioInteraction = this.addTwilioInteraction(interaction);

      const details = new RecordItem('', '', '');
      details.setPhone('', '', reservation.task.attributes.from);
      setInteraction({
        channelType: ChannelTypes.SMS,
        state: InteractionStates.Alerting,
        interactionId: reservation.taskSid,
        scenarioId: reservation.taskSid,
        direction: InteractionDirectionTypes.Inbound,
        details,
        userFocus: this.storageService.onFocusTaskId === reservation.taskSid
      });
      if (
        (this.incomingChatSMSRinger && !this.isChrome) ||
        (this.incomingChatSMSRinger && this.isChrome && this.userEnabledSound)
      ) {
        this.incomingChatSMSRinger.play();
      }
    }
  }

  private chatReservationCreated(reservation: IReservation) {
    let twilioInteraction = this.getTwilioInteractionByChannelSid(
      reservation.task.attributes.channelSid
    );
    if (twilioInteraction) {
      twilioInteraction.interaction.reservation = reservation;
      this.nextTwilioInteraction(twilioInteraction);
    } else {
      const interaction = {
        channel: CHANNELS.Chat,
        taskSid: reservation.taskSid,
        reservation,
        connection: null,
        parties: [],
        isHeld: false,
        isBlindTransfering: false,
        isWarmTransfering: false
      };
      twilioInteraction = this.addTwilioInteraction(interaction);

      const details = new RecordItem('', '', '');
      details.setPhone('', '', reservation.task.attributes.from);
      if (reservation && reservation.task && this.cadKeyDisplayMapping) {
        const attributeKeys = Object.keys(reservation.task.attributes);
        const configuredCADKeys = Object.keys(this.cadKeyDisplayMapping);
        for (const configuredKey of configuredCADKeys) {
          if (attributeKeys.includes(configuredKey)) {
            // Attributes has configured key. Create Property for CAD list.
            details.setField(
              this.cadKeyDisplayMapping[configuredKey],
              '',
              '',
              reservation.task.attributes[configuredKey]
            );
          }
        }
      }
      setInteraction({
        channelType: ChannelTypes.Chat,
        state: InteractionStates.Alerting,
        interactionId: reservation.taskSid,
        scenarioId: reservation.taskSid,
        direction: InteractionDirectionTypes.Inbound,
        details,
        userFocus: this.storageService.onFocusTaskId === reservation.taskSid
      });
    }
  }

  public sendOutboundSMS(from: string, to: string) {
    this.http
      .post('Outboundsms', {
        to: `+1${to}`,
        from: `+1${from}`,
        accountSid: this.accountSid,
        authToken: this.authToken
      })
      .subscribe(
        async (response) => {},
        (error) => {
          console.error(error);
          this.loggerService.logger.logError(error);
          sendNotification(
            'Initiate outbound sms failed. Please try again.',
            2
          );
        }
      );
  }

  /** ***********************************************************
    Controls
  /*************************************************************/
  public async answer(
    twilioInteraction: ITwilioInteraction,
    statusCallback: string
  ) {
    try {
      if (twilioInteraction.channel === CHANNELS.Phone) {
        // Incoming Blind Transfer
        try {
          if (
            twilioInteraction.reservation.task.attributes.blindTransfer !==
            undefined
          ) {
            if (
              twilioInteraction.reservation.task.attributes.blindTransfer.toString() ===
              'false'
            ) {
              twilioInteraction.incomingWarmTransfer = true;
            }
            this.acceptConference(
              twilioInteraction,
              twilioInteraction.reservation.task.attributes.from
            );
          } else if (
            twilioInteraction.reservation.task.attributes.conference !==
            undefined
          ) {
            this.acceptConference(
              twilioInteraction,
              twilioInteraction.reservation.task.attributes.from
            );
          } else {
            const reservation = await this.http
              .post('AcceptCallTask', {
                AccountSid: this.accountSid,
                AuthToken: this.authToken,
                WorkspaceSid: this.workSpaceSid,
                TaskSid: twilioInteraction.reservation.taskSid,
                ReservationSid: twilioInteraction.reservation.sid,
                StatusCallback: this.statusCallback,
                From: this.outboundNumber
              })
              .toPromise();
          }
        } catch (error) {
          this.loggerService.logger.logError('Unable to answer call: ' + error);
        }
      } else if (
        twilioInteraction.channel === CHANNELS.SMS ||
        twilioInteraction.channel === CHANNELS.Chat
      ) {
        twilioInteraction.reservation.accept(async (error, reservation) => {
          if (error) {
            throw error;
          }
          if (twilioInteraction.channel === CHANNELS.SMS) {
            try {
              const channel = await this.chatClient
                .getChannelBySid(
                  twilioInteraction.reservation.task.attributes.channelSid
                )
                .then((channel) => {
                  channel.join();
                });
            } catch (error) {
              this.loggerService.logger.logError(
                'Unable to join chat/SMS channel: ' + error
              );
            }
          } else {
            const channel = await this.chatClient
              .getChannelBySid(
                twilioInteraction.reservation.task.attributes.channelSid
              )
              .then((channel) => {
                channel.join();
              });
          }
        });
      }
    } catch (error) {
      this.loggerService.logger.logError('Answer failed: ' + error);
      sendNotification('Answer failed. Please try again.', 2);
    }
  }

  public async hangup(twilioInteraction: ITwilioInteraction) {
    try {
      if (twilioInteraction.channel === CHANNELS.Phone) {
        if (
          twilioInteraction.parties != null &&
          twilioInteraction.parties.length === 0
        ) {
          this.wrapup(twilioInteraction, true);
        } else {
          twilioInteraction.connection.disconnect();
        }
      } else if (twilioInteraction.channel === CHANNELS.Chat) {
        this.worker.completeTask(
          twilioInteraction.reservation.taskSid,
          (error, completedTask) => {}
        );
        // leave channel
        const channel = await this.chatClient
          .getChannelBySid(
            twilioInteraction.reservation.task.attributes.channelSid
          )
          .then((channel) => {
            channel.delete();
          });
        // remove channel
      } else if (twilioInteraction.channel.toUpperCase() === 'SMS') {
        this.worker.completeTask(
          twilioInteraction.reservation.taskSid,
          (error, completedTask) => {}
        );
      } else {
        this.worker.completeTask(
          twilioInteraction.reservation.taskSid,
          (error, completedTask) => {}
        );
      }
    } catch (error) {
      this.loggerService.logger.logError('Hangup failed: ' + error);
      sendNotification('Hangup failed. Please try again.', 2);
    }
  }

  public async createConference(twilioInteraction: ITwilioInteraction) {
    try {
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      if (
        twilioInteraction.connection['customParameters'].get('friendlyName') ===
        undefined
      ) {
        // Inbound Call
        await contextualOperation(
          ContextualOperationType.Conference,
          ChannelTypes.Telephony
        )
          .catch((error) => {
            if (error !== 'Canceled by user!') {
              this.loggerService.logger.logError(error);
              sendNotification('Conference failed.', 2);
            }
          })
          .then(async (contact) => {
            if (this.holdOnTransfer) {
              await this.holdForConference(twilioInteraction);
            }
            await this.sendConference(
              twilioInteraction,
              contact['uniqueId'],
              this.username,
              twilioInteraction.taskSid
            );
            this.nextTwilioInteraction(
              this.twilioInteractions[twilioInteraction.taskSid]
            );
          });
      } else {
        // Outbound Call
        await contextualOperation(
          ContextualOperationType.Conference,
          ChannelTypes.Telephony
        )
          .catch((error) => {
            if (error !== 'Canceled by user!') {
              this.loggerService.logger.logError(error);
              sendNotification('Conference failed.', 2);
            }
          })
          .then(async (contact) => {
            const conferenceSid = await this.getConferenceSid(
              twilioInteraction.connection['customParameters'].get(
                'friendlyName'
              )
            );
            if (this.holdOnTransfer) {
              await this.holdForConference(twilioInteraction);
            }
            await this.sendConference(
              twilioInteraction,
              contact['uniqueId'],
              this.username,
              twilioInteraction.taskSid,
              conferenceSid['conferenceSid']
            );
            this.nextTwilioInteraction(
              this.twilioInteractions[twilioInteraction.taskSid]
            );
          });
      }
    } catch (error) {
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      this.loggerService.logger.logError(
        'Unable to create conference: ' + error
      );
    }
  }

  public async sendConference(
    twilioInteraction: ITwilioInteraction,
    to: any,
    from: string,
    taskSid: string,
    conferenceSid?: string
  ) {
    try {
      const filteredTo = to.replace(/[-()]/g, '');
      const isInternal = isNaN(filteredTo); // True if this is an internal transfer, false if this is an external transfer
      if (conferenceSid === undefined) {
        let response = await this.http
          .post('GetConferenceSid', {
            AccountSid: this.accountSid,
            AuthToken: this.authToken,
            friendlyName: twilioInteraction.connection['customParameters'].get(
              'friendlyName'
            )
          })
          .toPromise();
        conferenceSid = response['conferenceSid'];
        if (conferenceSid === undefined) {
          response = await this.http
            .post('GetConferenceFromTask', {
              AccountSid: this.accountSid,
              AuthToken: this.authToken,
              WorkSpaceSid: this.workSpaceSid,
              TaskSid: twilioInteraction.reservation.task.sid
            })
            .toPromise();
          conferenceSid = response['conferenceSid'];
        }
      }
      await this.endConferencOnExit(conferenceSid, false);
      await this.http
        .post('Conference', {
          accountSid: this.accountSid,
          authToken: this.authToken,
          workspaceSid: this.workSpaceSid,
          workflowSid: this.directWorkflowSid,
          to: to,
          from: from,
          outboundNumber: this.outboundNumber,
          isInternal: isInternal,
          taskSid: taskSid,
          conferenceSid: conferenceSid,
          workerCallSid: twilioInteraction.connection.parameters.CallSid
        })
        .toPromise();
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
    } catch (e) {
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      this.loggerService.logger.logError(e);
      sendNotification('Conference Failed.', 2);
    }
  }

  public async blindTransfer(
    twilioInteraction: ITwilioInteraction,
    blindTransfer?: boolean
  ) {
    try {
      twilioInteraction.isBlindTransfering = blindTransfer;
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );

      if (
        twilioInteraction.connection['customParameters'].get('friendlyName') ===
        undefined
      ) {
        // internal
        await contextualOperation(
          ContextualOperationType.BlindTransfer,
          ChannelTypes.Telephony
        )
          .catch((error) => {
            if (error !== 'Canceled by user!') {
              this.loggerService.logger.logError(error);
              sendNotification('Transfer failed.', 2);
            }
          })
          .then((contact) => {
            this.sendTransfer(
              twilioInteraction,
              contact['uniqueId'],
              twilioInteraction.connection['customParameters'].get('phone'),
              true,
              twilioInteraction.taskSid
            );
          });
      } else {
        // external
        await contextualOperation(
          ContextualOperationType.BlindTransfer,
          ChannelTypes.Telephony
        )
          .catch((error) => {
            if (error !== 'Canceled by user!') {
              this.loggerService.logger.logError(error);
              sendNotification('Transfer failed.', 2);
            }
          })
          .then(async (contact) => {
            const conferenceSid = await this.getConferenceSid(
              twilioInteraction.connection['customParameters'].get(
                'friendlyName'
              )
            );
            await this.sendTransfer(
              twilioInteraction,
              contact['uniqueId'],
              this.outboundNumber,
              true,
              twilioInteraction.taskSid,
              conferenceSid['conferenceSid']
            );
          });
      }
    } catch (error) {
      twilioInteraction.isBlindTransfering = null;
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      this.loggerService.logger.logError('Unable to blind transfer: ' + error);
    }
  }

  public async warmTransfer(
    twilioInteraction: ITwilioInteraction,
    warmTransfer?: boolean
  ) {
    try {
      twilioInteraction.isWarmTransfering = warmTransfer;
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      if (
        twilioInteraction.connection['customParameters'].get('friendlyName') ===
        undefined
      ) {
        // Inbound Call
        await contextualOperation(
          ContextualOperationType.WarmTransfer,
          ChannelTypes.Telephony
        )
          .catch((error) => {
            if (error !== 'Canceled by user!') {
              this.loggerService.logger.logError(error);
              sendNotification('Transfer failed.', 2);
            }
          })
          .then(async (contact) => {
            if (this.holdOnTransfer) {
              await this.holdForConference(twilioInteraction);
            }
            await this.sendTransfer(
              twilioInteraction,
              contact['uniqueId'],
              this.username,
              false,
              twilioInteraction.taskSid
            );
            twilioInteraction.confirmingWarmTransfer = true;
            twilioInteraction.isWarmTransfering = null;
            this.nextTwilioInteraction(
              this.twilioInteractions[twilioInteraction.taskSid]
            );
          });
      } else {
        // Outbound Call
        await contextualOperation(
          ContextualOperationType.WarmTransfer,
          ChannelTypes.Telephony
        )
          .catch((error) => {
            if (error !== 'Canceled by user!') {
              this.loggerService.logger.logError(error);
              sendNotification('Transfer failed.', 2);
            }
          })
          .then(async (contact) => {
            const conferenceSid = await this.getConferenceSid(
              twilioInteraction.connection['customParameters'].get(
                'friendlyName'
              )
            );
            if (this.holdOnTransfer) {
              await this.holdForConference(twilioInteraction);
            }
            await this.sendTransfer(
              twilioInteraction,
              contact['uniqueId'],
              this.username,
              false,
              twilioInteraction.taskSid,
              conferenceSid['conferenceSid']
            );
            twilioInteraction.confirmingWarmTransfer = true;
            twilioInteraction.isWarmTransfering = null;
            this.nextTwilioInteraction(
              this.twilioInteractions[twilioInteraction.taskSid]
            );
          });
      }
    } catch (error) {
      twilioInteraction.isWarmTransfering = null;
      twilioInteraction.confirmingWarmTransfer = false;
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      this.loggerService.logger.logError('Unable to warm transfer: ' + error);
    }
  }

  public async sendTransfer(
    twilioInteraction: ITwilioInteraction,
    to: any,
    from: string,
    isBlind: boolean,
    taskSid: string,
    conferenceSid?: string
  ) {
    try {
      const filteredTo = to.replace(/[-()]/g, '');
      const isInternal = isNaN(filteredTo); // True if this is an internal transfer, false if this is an external transfer
      if (conferenceSid === undefined) {
        let response = await this.http
          .post('GetConferenceSid', {
            AccountSid: this.accountSid,
            AuthToken: this.authToken,
            friendlyName: twilioInteraction.connection['customParameters'].get(
              'friendlyName'
            )
          })
          .toPromise();
        conferenceSid = response['conferenceSid'];
        if (conferenceSid === undefined) {
          response = await this.http
            .post('GetConferenceFromTask', {
              AccountSid: this.accountSid,
              AuthToken: this.authToken,
              WorkSpaceSid: this.workSpaceSid,
              TaskSid: twilioInteraction.reservation.task.sid
            })
            .toPromise();
          conferenceSid = response['conferenceSid'];
        }
      }
      await this.http
        .post('Transfer', {
          accountSid: this.accountSid,
          authToken: this.authToken,
          workspaceSid: this.workSpaceSid,
          workflowSid: this.directWorkflowSid,
          to: to,
          from: from,
          outboundNumber: this.outboundNumber,
          isBlind: isBlind,
          isInternal: isInternal,
          taskSid: taskSid,
          conferenceSid: conferenceSid,
          workerCallSid: twilioInteraction.connection.parameters.CallSid
        })
        .toPromise();
      if (twilioInteraction.isBlindTransfering === true) {
        twilioInteraction.isBlindTransfering = null;
      }
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
    } catch (e) {
      twilioInteraction.isWarmTransfering = false;
      twilioInteraction.confirmingWarmTransfer = false;
      this.nextTwilioInteraction(
        this.twilioInteractions[twilioInteraction.taskSid]
      );
      this.loggerService.logger.logError(e);
      sendNotification('Transfer Failed.', 2);
    }
  }

  public async dtmf(twilioInteraction: ITwilioInteraction) {
    try {
      await contextualOperation(
        ContextualOperationType.DTMF,
        ChannelTypes.Telephony,
        async (contact) => {
          await twilioInteraction.connection.sendDigits(contact.uniqueId);
        }
      )
        .then(async (contact) => {})
        .catch((error) => {
          this.loggerService.logger.logError(
            'Unable to play DTMF tone: ' + error
          );
        });
    } catch (error) {
      this.loggerService.logger.logError('DTMF failed: ' + error);
    }
  }

  public async mute(twilioInteraction: ITwilioInteraction) {
    try {
      twilioInteraction.connection.mute(true);
      return await this.http
        .post('MuteParty', {
          AccountSid: this.accountSid,
          AuthToken: this.authToken,
          ConferenceSid:
            twilioInteraction.reservation.task.attributes.conference['sid'],
          CallSid: twilioInteraction.connection.parameters.CallSid,
          Mute: true
        })
        .toPromise();
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('Mute call Failed. Please try again.', 2);
    }
  }

  public async unmute(twilioInteraction: ITwilioInteraction) {
    try {
      twilioInteraction.connection.mute(false);
      return await this.http
        .post('MuteParty', {
          AccountSid: this.accountSid,
          AuthToken: this.authToken,
          ConferenceSid:
            twilioInteraction.reservation.task.attributes.conference['sid'],
          CallSid: twilioInteraction.connection.parameters.CallSid,
          Mute: false
        })
        .toPromise();
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('Unmute call failed. Please try again.', 2);
    }
  }

  public reject(twilioInteraction: ITwilioInteraction) {
    try {
      twilioInteraction.reservation.reject();
      if (this.incomingPhoneRinger && !this.incomingPhoneRinger.paused) {
        this.incomingPhoneRinger.pause();
      }
      if (this.incomingChatSMSRinger && !this.incomingChatSMSRinger.paused) {
        this.incomingChatSMSRinger.pause();
      }
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('Reject call failed. Please try again.', 2);
    }
  }

  public async hold(
    twilioInteraction: ITwilioInteraction,
    hold = true,
    transfering = false
  ) {
    try {
      if (hold === false) {
        // When unholding one device we put the rest on hold first
        await this.holdDevices();
      }
      const result = this.http
        .post('Hold', {
          callSid: twilioInteraction.connection.parameters.CallSid,
          hold
        })
        .toPromise();

      // Note: it might be better if we could keep track of held calls server side or twilio side
      if (!transfering) {
        result.then(() => {
          this.twilioInteractions[
            twilioInteraction.taskSid
          ].interaction.isHeld = hold;
          this.nextTwilioInteraction(
            this.twilioInteractions[twilioInteraction.taskSid]
          );
        });
      }
      return result;
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('Hold call failed. Please try again', 2);
    }
  }

  public async initiateOutbound(to: string) {
    try {
      if (!this.checkDevices('ready')) {
        // if there isn't a ready device throw an error
        sendNotification('Maximum number of active calls reached.', 2);
        return;
      }
      await this.holdDevices();
      for (const device of this.devices) {
        // Check for a ready device, if there is one connect to it
        if (device) {
          if (device.status() === 'ready') {
            if (this.workmodeMap['Ready'] !== this.currentActivity) {
              await this.setActivity(this.workmodeMap['Ready']);
              this.previousActivity = 'Not Ready';
            }
            this.createOutboundTask(this.conferenceFriendlyName, to);
            return;
          }
        }
      }
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('Outbound dial failed. Please try again.', 2);
    }
  }

  public sendMessage(sid: string, message: string) {
    try {
      const twilioInteraction = this.twilioInteractions[sid];
      if (!twilioInteraction) {
        throw new Error(
          'Twilio interaction not found! Message will not be sent. sid=' + sid
        );
      }
      if (!twilioInteraction.interaction.chat) {
        throw new Error(
          'No active chat for twilio interaction. Message will not be sent. sid=' +
            sid
        );
      }
      twilioInteraction.interaction.chat.channel.sendMessage(message);
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('Send message failed. Please try again.', 2);
    }
  }

  public focus(twilioInteraction: ITwilioInteraction) {
    try {
      this.storageService.setOnFocus(twilioInteraction.taskSid);
      setInteraction({
        interactionId: this.storageService.onFocusTaskId,
        scenarioId: this.storageService.onFocusTaskId,
        direction: twilioInteraction.reservation
          ? InteractionDirectionTypes.Inbound
          : InteractionDirectionTypes.Outbound,
        userFocus: true
      });
    } catch (e) {
      this.loggerService.logger.logError(e);
      sendNotification('focus failed. Please try again.', 2);
    }
  }

  public async addParty(conferenceSid: string, to: string, from: string) {
    return await this.http
      .post('addParty', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        ConferenceSid: conferenceSid,
        From: from,
        To: to
      })
      .toPromise();
  }

  public async removeParty(
    twilioInteraction: ITwilioInteraction,
    callSid: string
  ) {
    if (
      twilioInteraction.confirmingWarmTransfer === true &&
      callSid !== twilioInteraction.connection.parameters.CallSid
    ) {
      twilioInteraction.confirmingWarmTransfer = null;
      twilioInteraction.isWarmTransfering = null;
    }
    await this.http
      .post('RemoveParty', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        ConferenceSid:
          twilioInteraction.reservation.task.attributes.conference['sid'],
        CallSid: callSid
      })
      .toPromise();
    await twilioInteraction.parties.forEach((party, index) => {
      if (party === callSid) {
        twilioInteraction.parties.splice(index, 1);
      }
    });
    await this.nextTwilioInteraction(
      this.getTwilioInteractionByTaskSid(twilioInteraction.reservation.taskSid)
    );
  }

  public async holdParty(
    twilioInteraction: ITwilioInteraction,
    callSid: string
  ) {
    return await this.http
      .post('HoldParty', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        ConferenceSid:
          twilioInteraction.reservation.task.attributes.conference['sid'],
        CallSid: callSid
      })
      .toPromise();
  }

  public async holdForConference(twilioInteraction: ITwilioInteraction) {
    if (
      twilioInteraction.parties != null &&
      twilioInteraction.parties.length < 3
    ) {
      for (let i = 0; i < twilioInteraction.parties.length; i++) {
        if (
          twilioInteraction.parties[i] !==
          twilioInteraction.connection.parameters.CallSid
        ) {
          await this.holdParty(twilioInteraction, twilioInteraction.parties[i]);
        }
      }
    }
  }

  public async getHeldParticipants(twilioInteraction: ITwilioInteraction) {
    return await this.http
      .post('GetHeldParticipants', {
        AccountSid: this.accountSid,
        AuthToken: this.authToken,
        ConferenceSid:
          twilioInteraction.reservation.task.attributes.conference['sid']
      })
      .toPromise();
  }

  public async resetInteraction(twilioInteraction: ITwilioInteraction) {
    twilioInteraction.isBlindTransfering = null;
    twilioInteraction.isWarmTransfering = null;
    twilioInteraction.confirmingWarmTransfer = null;
    twilioInteraction.incomingWarmTransfer = null;
    this.nextTwilioInteraction(
      this.getTwilioInteractionByTaskSid(twilioInteraction.reservation.taskSid)
    );
  }

  public getOutboundNumber() {
    return this.outboundNumber;
  }
}

interface ICapabilityTokens {
  startingActivitySid: string;
  taskRouterToken: string;
  voiceToken: string;
  chatToken: string;
  accountSid: string;
  authToken: string;
}
