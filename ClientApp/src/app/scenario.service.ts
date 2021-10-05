import { Injectable } from '@angular/core';
import {
  sendNotification,
  getUserDetails,
  getConfig
} from '@amc-technology/davinci-api';
import { TwilioService } from './twilio.service';
import {
  Observable,
  combineLatest,
  BehaviorSubject,
  Subject,
  interval,
  ReplaySubject
} from 'rxjs';
import { map, tap, first, withLatestFrom } from 'rxjs/operators';
import {
  IScenario,
  IOperation,
  IMetadata,
  IInteraction,
  IChatMessageType,
  Property,
  IParty,
  IFocus
} from '@amc-technology/ui-library';
import { ITwilioInteraction, CHANNELS } from './model/TwilioInteraction';
import { AmcService } from './amc.service';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root'
})
export class ScenarioService {
  test$ = new Subject<BehaviorSubject<IScenario>>();
  scenarios$: ReplaySubject<ReplaySubject<IScenario>> = new ReplaySubject<
    ReplaySubject<IScenario>
  >(1);

  private tasks$: Observable<Observable<ITwilioInteraction>>;
  private conferenceStatusCallback: string;
  private iconPack: string;
  private username: string;
  private interactionChannelConfig;
  private agentFriendlyName: string;
  private agentDetails: any;
  private config: any;
  private shouldDisplayCAD: boolean;
  private cadKeyDisplayMapping: any;
  private enableDTMF = false;

  constructor(
    private twilio: TwilioService,
    private amcService: AmcService,
    private loggerService: LoggerService
  ) {
    this.setup(twilio, amcService, loggerService);
  }

  async setup(
    twilio: TwilioService,
    amcService: AmcService,
    loggerService: LoggerService
  ) {
    this.cadKeyDisplayMapping = null;
    await this.pullConfig();
    const singlePartyOperations = this.enableDTMF
      ? [
          this.createHangupOperation,
          this.createHoldOperation,
          this.createMuteOperation,
          this.createBlindTransferOperation,
          this.createWarmTransferOperation,
          this.createConferenceOperation,
          this.createPlayDTMFOperation
        ]
      : [
          this.createHangupOperation,
          this.createHoldOperation,
          this.createMuteOperation,
          this.createBlindTransferOperation,
          this.createWarmTransferOperation,
          this.createConferenceOperation
        ];
    const multiPartyOperations = this.enableDTMF
      ? [
          this.createHangupOperation,
          this.createHoldOperation,
          this.createMuteOperation,
          this.createConferenceOperation,
          this.createPlayDTMFOperation
        ]
      : [
          this.createHangupOperation,
          this.createHoldOperation,
          this.createMuteOperation,
          this.createConferenceOperation
        ];
    this.interactionChannelConfig = {
      [CHANNELS.Chat]: {
        subheaderData: {
          tooltip: 'Chat',
          image: 'chat_symbol.png',
          value: ''
        },
        state: {
          Alerting: {
            statusText: 'Incoming Chat',
            operations: [
              this.createAnswerChatOperation,
              this.createRejectChatOperation
            ]
          },
          Connected: {
            statusText: 'Chatting - Web',
            operations: [this.createEndChatOperation]
          }
        }
      },
      [CHANNELS.SMS]: {
        subheaderData: {
          tooltip: 'SMS',
          image: 'chat_symbol.png',
          value: ''
        },
        state: {
          Alerting: {
            statusText: 'Incoming SMS',
            operations: [
              this.createAnswerChatOperation,
              this.createRejectChatOperation
            ]
          },
          Connected: {
            statusText: 'Chatting - SMS',
            operations: [this.createEndChatOperation]
          }
        }
      },
      [CHANNELS.Phone]: {
        subheaderData: {
          tooltip: 'Telephony',
          image: 'Phone_Number_Icon.png',
          value: ''
        },
        state: {
          Disconnected: {
            statusText: 'Wrapup',
            operations: [this.createWrapupOperation]
          },
          Alerting: {
            statusText: 'Ringing',
            operations: [this.createAnswerOperation, this.createRejectOperation]
          },
          Connected: {
            statusText: 'On Call',
            operations: singlePartyOperations
          },
          BlindTransfer: {
            statusText: 'Blind Transfer',
            operations: [
              this.createHangupDisabledOperation,
              this.createHoldDisabledOperation,
              this.createMuteDisabledOperation
            ]
          },
          WarmTransfer: {
            statusText: 'Warm Transfer',
            operations: [
              this.createHangupDisabledOperation,
              this.createHoldDisabledOperation,
              this.createMuteDisabledOperation
            ]
          },
          WaitingWarmTransfer: {
            statusText: 'Warm Transfer',
            operations: [
              this.createMuteOperation,
              this.createCancelWarmTransferOperation
            ]
          },
          ConfirmWarmTransfer: {
            statusText: 'Warm Transfer',
            operations: [
              this.createMuteOperation,
              this.createConfirmWarmTransferOperation,
              this.createCancelWarmTransferOperation
            ]
          },
          IncomingWarmTransfer: {
            statusText: 'Warm Transfer',
            operations: [
              this.createHangupOperation,
              this.createMuteOperation,
              this.createCancelWarmTransferOperation
            ]
          },
          Muted: {
            statusText: 'Muted',
            operations: [this.createUnmuteOperation]
          },
          Held: {
            statusText: 'On Hold',
            operations: [this.createUnholdOperation]
          },
          ConnectedConference: {
            statusText: 'On Call',
            operations: multiPartyOperations
          }
        }
      }
    };

    const config$ = amcService.config$.pipe(first());
    config$.subscribe((config) => {
      this.loggerService.logger = config.logger;
      this.conferenceStatusCallback = config.conferenceStatusCallback;
      this.iconPack = config.iconPack;
      this.username = config.username;
    });

    this.tasks$ = this.twilio.getTasks();
    this.tasks$.subscribe(async (task) => {
      const scenarioReplay = new ReplaySubject<IScenario>(1);
      this.scenarios$.next(scenarioReplay);
      task.subscribe(
        async (tasky) => {
          scenarioReplay.next(await this.createIScenario(tasky));
        },
        async (error) => {},
        async () => {
          scenarioReplay.complete();
        }
      );
    });
  }

  async pullConfig() {
    this.config = await getConfig();
    if (
      this.config.CADDisplay &&
      this.config.CADDisplay.variables &&
      this.config.CADDisplay.variables.DisplayCAD
    ) {
      this.shouldDisplayCAD = true;
    } else {
      this.shouldDisplayCAD = false;
    }
    if (
      this.config.CADDisplay &&
      this.config.CADDisplay.variables &&
      this.config.CADDisplay.variables.DisplayKeyList
    ) {
      this.cadKeyDisplayMapping = this.config.CADDisplay.variables.DisplayKeyList;
    }
    if (
      this.config.Phone.variables.enableDTMF &&
      this.config.Phone.variables.enableDTMF === true
    ) {
      this.enableDTMF = true;
    }
  }

  // This disable is necessary because the if else statement in this function is too long and can't be shortened
  // eslint-disable-next-line max-statements
  async createIScenario(
    twilioInteraction: ITwilioInteraction
  ): Promise<IScenario> {
    function formatTimestamp(date: Date) {
      const hours = date.getHours();
      const minutes = date.getMinutes();
      let formatMinutes = minutes.toString();
      if (minutes < 10) {
        formatMinutes = '0' + minutes.toString();
      }
      if (hours === 0) {
        return '12:' + formatMinutes + 'am';
      } else if (hours === 12) {
        return '12:' + formatMinutes + 'pm';
      } else if (hours >= 13) {
        return hours - 12 + ':' + formatMinutes + 'pm';
      } else {
        return hours + ':' + formatMinutes + 'am';
      }
    }
    let phoneNumber = '';
    if (
      twilioInteraction.connection &&
      twilioInteraction.connection.message &&
      twilioInteraction.connection.message.phone !== undefined
    ) {
      phoneNumber = twilioInteraction.connection.message.phone;
    } else if (twilioInteraction.reservation) {
      phoneNumber = twilioInteraction.reservation.task.attributes.from;
    } else {
      phoneNumber = 'Unknown';
    }
    let isInbound = twilioInteraction.reservation != null;
    if (twilioInteraction.reservation) {
      if (
        twilioInteraction.reservation.task.attributes['outbound'] !== undefined
      ) {
        isInbound = !(
          twilioInteraction.reservation.task.attributes[
            'outbound'
          ].toString() === 'true'
        );
      }
    }

    const subheaderData = {
      tooltip: this.interactionChannelConfig[twilioInteraction.channel]
        .subheaderData.tooltip,
      value: phoneNumber,
      image: new URL(
        this.iconPack +
          this.interactionChannelConfig[twilioInteraction.channel].subheaderData
            .image
      )
    };

    let startTime: Date;
    if (twilioInteraction.reservation) {
      startTime = new Date(twilioInteraction.reservation.task.dateCreated);
    } else {
      startTime = new Date();
    }
    let interaction: IInteraction;
    if (
      twilioInteraction.parties != null &&
      twilioInteraction.parties.length > 2 &&
      !twilioInteraction.isWrapup
    ) {
      const calls: any[] = [];
      await Promise.all(
        twilioInteraction.parties.map(async (party) => {
          if (party !== twilioInteraction.connection.parameters.CallSid) {
            calls.push(await this.twilio.getCallInformation(party));
            // this populates the parties array with Twilio Call objects
          }
        })
      );
      const heldParticipants = await this.twilio.getHeldParticipants(
        twilioInteraction
      );
      const parties = await this.checkParties(
        twilioInteraction,
        calls,
        heldParticipants['participants']
      );
      interaction = {
        displayCallTimer: true,
        subheaderData,
        startTime: startTime.getTime(),
        interactionId: twilioInteraction.taskSid,
        parties: parties,
        UIHeadersData: {
          minimizeUrl: new URL(this.iconPack + 'section_collapse.png'),
          maximizeUrl: new URL(this.iconPack + 'section_expand.png'),
          statusUrl: new URL(this.iconPack + 'Status_OnCall.png'),
          focusHandler: this.createOnFocusOperation(twilioInteraction),
          statusText: 'On Call',
          directionText: isInbound ? 'Inbound' : 'Outbound',
          displayHoldCounter: false
        },
        operations: []
      };
    } else {
      interaction = {
        displayCallTimer: true,
        subheaderData,
        startTime: startTime.getTime(),
        interactionId: twilioInteraction.taskSid,
        UIHeadersData: {
          minimizeUrl: new URL(this.iconPack + 'section_collapse.png'),
          maximizeUrl: new URL(this.iconPack + 'section_expand.png'),
          statusUrl: new URL(this.iconPack + 'Status_OnCall.png'),
          focusHandler: this.createOnFocusOperation(twilioInteraction),
          statusText: 'On Call',
          directionText: isInbound ? 'Inbound' : 'Outbound',
          displayHoldCounter: false
        },
        operations: []
      };
    }

    if (
      twilioInteraction.reservation &&
      (twilioInteraction.reservation.task.assignmentStatus === 'canceled' ||
        twilioInteraction.reservation.task.assignmentStatus === 'completed')
    ) {
      return null;
    }

    let state: string;
    if (!(twilioInteraction.connection || twilioInteraction.chat || twilioInteraction.isWrapup)) {
      state = 'Alerting';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_Ringing.png'
      );
    } else if (twilioInteraction.isWrapup) {
      state = 'Disconnected';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnCall.png'
      );
    } else if (
      twilioInteraction.connection &&
      twilioInteraction.connection.isMuted()
    ) {
      state = 'Muted';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnMute.png'
      );
    } else if (twilioInteraction.isHeld) {
      state = 'Held';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnHold.png'
      );
    } else if (twilioInteraction.isBlindTransfering) {
      state = 'BlindTransfer';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnCall.png'
      );
    } else if (twilioInteraction.confirmingWarmTransfer) {
      if (
        twilioInteraction.parties != null &&
        twilioInteraction.parties.length > 2
      ) {
        state = 'ConfirmWarmTransfer';
        interaction.UIHeadersData.statusUrl = new URL(
          this.iconPack + 'Status_OnCall.png'
        );
      } else {
        state = 'WaitingWarmTransfer';
        interaction.UIHeadersData.statusUrl = new URL(
          this.iconPack + 'Status_OnCall.png'
        );
      }
    } else if (twilioInteraction.isWarmTransfering) {
      state = 'WarmTransfer';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnCall.png'
      );
    } else if (twilioInteraction.incomingWarmTransfer) {
      state = 'IncomingWarmTransfer';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnCall.png'
      );
    } else if (twilioInteraction.isWrapup) {
      state = 'Disconnected';
      interaction.UIHeadersData.statusUrl = new URL(
        this.iconPack + 'Status_OnCall.png'
      );
    } else {
      if (
        twilioInteraction.parties != null &&
        twilioInteraction.parties.length > 2
      ) {
        state = 'ConnectedConference';
        interaction.UIHeadersData.statusUrl = new URL(
          this.iconPack + 'Status_OnCall.png'
        );
      } else {
        state = 'Connected';
        interaction.UIHeadersData.statusUrl = new URL(
          this.iconPack + 'Status_OnCall.png'
        );
      }
      if (
        twilioInteraction.channel === CHANNELS.SMS ||
        twilioInteraction.channel === CHANNELS.Chat
      ) {
        interaction.chat = {
          settings: {
            sendImage: new URL(this.iconPack + 'request_send.png'),
            maxHeight: '300px'
          },
          messages: twilioInteraction.chat.messages.map((message) => ({
            username:
              this.username === message.author
                ? this.agentFriendlyName
                : message.author,
            text: message.body,
            timestamp: formatTimestamp(message.timestamp),
            type:
              this.username === message.author
                ? IChatMessageType.AGENT
                : IChatMessageType.OTHER_PERSON
          })),
          isCustomerTyping: false
        };
      }
    }
    const stateConfig = this.interactionChannelConfig[twilioInteraction.channel]
      .state[state];
    interaction.UIHeadersData.statusText = stateConfig.statusText;
    interaction.operations = stateConfig.operations.map((operationFactory) =>
      operationFactory(twilioInteraction)
    );
    if (this.shouldDisplayCAD && this.cadKeyDisplayMapping) {
      const propertiesArray = [];
      if (
        twilioInteraction &&
        twilioInteraction.reservation &&
        twilioInteraction.reservation.task
      ) {
        const attributeKeys = Object.keys(
          twilioInteraction.reservation.task.attributes
        );
        const configuredCADKeys = Object.keys(this.cadKeyDisplayMapping);
        for (const configuredKey of configuredCADKeys) {
          if (attributeKeys.includes(configuredKey)) {
            // Attributes has configured key. Create Property for CAD list.
            propertiesArray.push(
              new Property(
                this.cadKeyDisplayMapping[configuredKey],
                '  ' +
                  twilioInteraction.reservation.task.attributes[configuredKey]
              )
            );
          }
        }
      }
      interaction.associatedData = propertiesArray;
    } else {
      // shouldDisplayCAD is configured to false. Send Properties as empty array
      interaction.associatedData = [];
    }

    return { interactions: [interaction] };
  }

  createHoldOperation = (twilioInteraction: ITwilioInteraction): any => ({
    operationName: 'Hold',
    icon: new URL(this.iconPack + 'voice_hold_normal.png'),
    title: 'Hold',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.hold(twilioInteraction, true);
    }
  });

  createHoldDisabledOperation = (
    twilioInteraction: ITwilioInteraction
  ): any => ({
    operationName: 'Hold Disabled',
    icon: new URL(this.iconPack + 'voice_hold_normal.png'),
    title: 'Hold Disabled',
    handler: async (
      operationName: string,
      operationMetadata?: IMetadata[]
    ) => {}
  });

  createUnholdOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Unhold',
    icon: new URL(this.iconPack + 'voice_unhold_normal.png'),
    title: 'Unhold',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.hold(twilioInteraction, false);
    }
  });

  createMuteOperation = (twilioInteraction: ITwilioInteraction): any => ({
    operationName: 'Mute',
    icon: new URL(this.iconPack + 'mute.png'),
    title: 'Mute',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.mute(twilioInteraction);
    }
  });

  createUnmuteOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Unmute',
    icon: new URL(this.iconPack + 'unmute.png'),
    title: 'Unmute',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.unmute(twilioInteraction);
    }
  });

  createMuteDisabledOperation = (
    twilioInteraction: ITwilioInteraction
  ): any => ({
    operationName: 'Mute Disabled',
    icon: new URL(this.iconPack + 'mute.png'),
    title: 'Mute',
    handler: async (
      operationName: string,
      operationMetadata?: IMetadata[]
    ) => {}
  });

  createHangupOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Hangup',
    icon: new URL(this.iconPack + 'voice_end_normal.png'),
    title: 'Hangup',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      if (twilioInteraction.incomingWarmTransfer) {
        this.twilio.removeParty(
          twilioInteraction,
          twilioInteraction.connection.parameters.CallSid
        );
      } else {
        if (
          twilioInteraction.parties != null &&
          twilioInteraction.parties.length > 2
        ) {
          this.twilio.removeParty(
            twilioInteraction,
            twilioInteraction.connection.parameters.CallSid
          );
        } else {
          this.twilio.hangup(twilioInteraction);
        }
      }
    }
  });

  createHangupDisabledOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Hangup Disabled',
    icon: new URL(this.iconPack + 'voice_end_normal.png'),
    title: 'Hangup Disabled',
    handler: async (
      operationName: string,
      operationMetadata?: IMetadata[]
    ) => {}
  });

  createPlayDTMFOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => {
    if (this.enableDTMF) {
      return {
        operationName: 'DTMF',
        icon: new URL(this.iconPack + 'Dialpad.png'),
        title: 'Show DTMF',
        handler: async (
          operationName: string,
          operationMetadata?: IMetadata[]
        ) => {
          this.twilio.dtmf(twilioInteraction);
        }
      };
    }
  };

  createBlindTransferOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Blind Transfer',
    icon: new URL(this.iconPack + 'voice_blindtransfer_normal.png'),
    title: 'Blind Transfer',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.blindTransfer(twilioInteraction, true);
    }
  });

  createWarmTransferOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Warm Transfer',
    icon: new URL(this.iconPack + 'voice_warmtransfer_normal.png'),
    title: 'Warm Transfer',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.warmTransfer(twilioInteraction, true);
    }
  });

  createConfirmWarmTransferOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Confirm Warm Transfer',
    icon: new URL(this.iconPack + 'accept_work.png'),
    title: 'Confirm Warm Transfer',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.hold(twilioInteraction, false, true);
      await this.twilio.removeParty(
        twilioInteraction,
        twilioInteraction.connection.parameters.CallSid
      );
    }
  });

  createConfirmIncomingWarmTransferOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Confirm Warm Transfer',
    icon: new URL(this.iconPack + 'accept_work.png'),
    title: 'Confirm Warm Transfer',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.hold(twilioInteraction, false, true);
      await this.twilio.removeParty(
        twilioInteraction,
        twilioInteraction.connection.parameters.CallSid
      );
    }
  });

  createCancelWarmTransferOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Cancel',
    icon: new URL(this.iconPack + 'voice_warmtransfer_cancel.png'),
    title: 'Cancel',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.holdForConference(twilioInteraction);
      await this.twilio.resetInteraction(twilioInteraction);
    }
  });

  createEndChatOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'EndChat',
    icon: new URL(this.iconPack + 'chat_end_normal.png'),
    title: 'End',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.hangup(twilioInteraction);
    }
  });

  createAnswerOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Answer',
    icon: new URL(this.iconPack + 'voice_alerting_answer_normal.gif'),
    title: 'Answer',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.answer(
        twilioInteraction,
        this.conferenceStatusCallback
      );
    }
  });

  createAnswerChatOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Answer',
    icon: new URL(this.iconPack + 'chat_check_normal.gif'),
    title: 'Accept',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      await this.twilio.answer(
        twilioInteraction,
        this.conferenceStatusCallback
      );
    }
  });

  createRejectOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Reject',
    icon: new URL(this.iconPack + 'voice_end_normal.png'),
    title: 'Reject',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.reject(twilioInteraction);
    }
  });

  createRejectChatOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Reject',
    icon: new URL(this.iconPack + 'chat_end_normal.png'),
    title: 'Reject',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.reject(twilioInteraction);
    }
  });

  createConferenceOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Conference',
    icon: new URL(this.iconPack + 'voice_conference_normal.png'),
    title: 'Conference',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.createConference(twilioInteraction);
    }
  });

  checkParties = (
    twilioInteraction: ITwilioInteraction,
    calls: any[],
    heldParticipants: any[]
  ): IParty[] => {
    const parties: Array<IParty> = [];
    if (calls != null && calls.length >= 2) {
      for (let i = 0; i < calls.length; i++) {
        let currentParty: IParty;
        let phoneNumber = calls[i]['to_formatted'];
        if (phoneNumber === '') {
          if (calls[i]['from_formatted'] === 'Anonymous') {
            if (
              twilioInteraction.reservation.task.attributes['originalAgent']
            ) {
              phoneNumber = twilioInteraction.reservation.task.attributes[
                'originalAgent'
              ].replace('client:', '');
            } else {
              phoneNumber = twilioInteraction.reservation.task.attributes[
                'from'
              ].replace('client:', '');
            }
          } else {
            phoneNumber = calls[i]['from_formatted'];
          }
        } else if (calls[i]['to'] === this.twilio.getOutboundNumber()) {
          phoneNumber = calls[i]['from_formatted'];
        }
        let held = false;
        for (let j = 0; j < heldParticipants.length; j++) {
          if (heldParticipants[j]['call_sid'] === calls[i]['sid']) {
            held = true;
          }
        }
        if (held) {
          currentParty = {
            header: {
              image: new URL(this.iconPack + 'Phone_Number_Icon.png'),
              tooltip: 'Phone',
              value: phoneNumber
            },
            operations: [
              this.createUnholdPartyOperation(
                twilioInteraction,
                calls[i]['sid']
              )
            ],
            properties: []
          };
        } else {
          currentParty = {
            header: {
              image: new URL(this.iconPack + 'Phone_Number_Icon.png'),
              tooltip: 'Phone',
              value: phoneNumber
            },
            operations: [
              this.createRemovePartyOperation(
                twilioInteraction,
                calls[i]['sid']
              ),
              this.createHoldPartyOperation(twilioInteraction, calls[i]['sid'])
            ],
            properties: []
          };
        }
        parties.push(currentParty);
      }
      parties.sort((a, b) => {
        const nameA = a.header.value;
        const nameB = b.header.value;
        if (nameA < nameB) {
          return -1;
        }
        if (nameA > nameB) {
          return 1;
        }
        return 0;
      });
      return parties;
    }
  };

  createHoldPartyOperation = (
    twilioInteraction: ITwilioInteraction,
    callSid: string
  ): IOperation => ({
    operationName: 'Hold Participant',
    icon: new URL(this.iconPack + 'voice_hold_normal.png'),
    title: 'Hold Participant',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.holdParty(twilioInteraction, callSid);
    }
  });

  createUnholdPartyOperation = (
    twilioInteraction: ITwilioInteraction,
    callSid: string
  ): IOperation => ({
    operationName: 'Unhold Participant',
    icon: new URL(this.iconPack + 'voice_unhold_normal.png'),
    title: 'Unhold Participant',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.holdParty(twilioInteraction, callSid);
    }
  });

  createRemovePartyOperation = (
    twilioInteraction: ITwilioInteraction,
    callSid: string
  ): IOperation => ({
    operationName: 'Remove Participant',
    icon: new URL(this.iconPack + 'voice_end_normal.png'),
    title: 'Remove Participant',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.removeParty(twilioInteraction, callSid);
    }
  });

  createOnFocusOperation = (twilioInteraction: ITwilioInteraction): IFocus => ({
    operationName: 'OnFocus',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.focus(twilioInteraction);
    }
  });

  createWrapupOperation = (
    twilioInteraction: ITwilioInteraction
  ): IOperation => ({
    operationName: 'Wrapup',
    icon: new URL(this.iconPack + 'Complete_WrapUp_TwilioFlex.png'),
    title: 'Wrapup',
    handler: async (operationName: string, operationMetadata?: IMetadata[]) => {
      this.twilio.completeTask(twilioInteraction.taskSid);
      this.twilio.deleteTwilioInteraction(twilioInteraction.taskSid);
    }
  });
}
