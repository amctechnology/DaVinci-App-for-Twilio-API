/* eslint-disable no-shadow */
import { ITask } from './Task';
import { MapType } from '@angular/compiler';

export interface ITwilioInteraction {
  channel: CHANNELS;
  taskSid: string;
  conferenceSid?: string;
  parties: any[];
  reservation?: IReservation;
  connection?: IConnection;
  chat?: {
    channel: any;
    messages: any[];
  };
  isHeld?: boolean;
  isBlindTransfering?: boolean;
  isWarmTransfering?: boolean;
  confirmingWarmTransfer?: boolean;
  incomingWarmTransfer?: boolean;
  isWrapup?: boolean;
  conferenceFriendlyName?: string;
}

export interface IConnection {
  direction: CONNECTION_DIRECTION;
  parameters: {
    AccountSid: string;
    CallSid: string;
    TaskSid: string;
    From: string; // phone number
    To: string;
    customParameters: any;
  };
  message?: { [key: string]: any };
  accept?: (handlerOrConstraints: any) => void;
  cancel?: (handler: any) => void;
  disconnect?: (handler?: any) => void;
  error?: (handler: any) => void;
  getLocalStream?: () => any;
  getRemoteStream?: () => any;
  ignore?: (handler: any) => void;
  isMuted?: () => boolean;
  mute?: (shouldMute: boolean) => void;
  postFeedback?: (score, issue) => any;
  reject?: (handler: any) => void;
  sendDigits?: (digits) => any;
  status?: () => any;
  unmute?: () => any;
  volume?: (handler: any) => void;
}

export enum CHANNELS {
  'SMS' = 'SMS',
  'Phone' = 'Phone',
  'Chat' = 'Chat'
}
export interface IReservation {
  task: ITask;
  taskSid: string;
  dequeue: (params: any) => void;
  [key: string]: any;
  // This is not complete
}

export enum CONNECTION_DIRECTION {
  'INCOMING' = 'INCOMING',
  'OUTBOUND' = 'OUTBOUND'
}
