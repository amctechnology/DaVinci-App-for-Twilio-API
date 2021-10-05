using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Twilio;
using Twilio.Http;
using Twilio.Jwt;
using Twilio.Jwt.AccessToken;
using Twilio.Jwt.Client;
using Twilio.Jwt.Taskrouter;
using Twilio.Rest.Api.V2010.Account;
using Twilio.Rest.Api.V2010.Account.Conference;
using Twilio.Rest.Studio.V1.Flow;
using Twilio.Rest.Taskrouter.V1.Workspace;
using Twilio.Rest.Taskrouter.V1.Workspace.Task;
using TwilioApiApp.Models;

namespace TwilioApiApp.Controllers {
  public class TwilioController : Controller {
    string accountSid;
    string authToken;
    string workspaceSid;
    string directWorkflowSid;
    string apiUrl;
    string apiDomain;
    string chatServiceSid;
    string chatApiSid;
    string chatApiSecret;
    string voiceApplicationSid;
    public TwilioController (IConfiguration configuration) {
      /*
          TODO:
          - store multiple sub accounts login
          - how to use twilio apis with multiple accounts?
       */
      apiUrl = configuration.GetValue<string> ("ClientConfiguration:ApiUrl");
      apiDomain = configuration.GetValue<string> ("ApiDomain");
    }
    public class HoldCallParam {
      public string callSid;
      public bool hold;
    }

    [HttpPost ("/Hold")]
    public IActionResult Hold ([FromBody] HoldCallParam holdCallParam) {
      var conferences = ConferenceResource.Read (
        status: ConferenceResource.StatusEnum.InProgress
      );
      foreach (var conference in conferences) {
        var participants = ParticipantResource.Read (
          pathConferenceSid: conference.Sid
        );
        foreach (var participant in participants) {
          if (participant.CallSid == holdCallParam.callSid) {
            foreach (var otherParticipant in participants) {
              if (otherParticipant != participant) {
                ParticipantResource.Update (
                  hold: holdCallParam.hold,
                  pathConferenceSid: conference.Sid,
                  pathCallSid: otherParticipant.CallSid
                );
              }
            }

            return Ok ();
          }
        }
      }

      return NotFound ();
    }
    public class AcceptCallTaskParameters {
      public String AccountSid;
      public String AuthToken;
      public String WorkspaceSid;
      public String TaskSid;
      public String ReservationSid;
      public String From;
      public String StatusCallback;
    }

    [HttpPost ("/AcceptCallTask")]
    public IActionResult acceptCallTask ([FromBody] AcceptCallTaskParameters acceptCallTaskParameters) {

      try {
        var statusCallback = new Uri (acceptCallTaskParameters.StatusCallback);

        TwilioClient.Init (acceptCallTaskParameters.AccountSid, acceptCallTaskParameters.AuthToken);

        var conferenceStatusCallbackEvent = new [] {
          ReservationResource.ConferenceEventEnum.Start,
            ReservationResource.ConferenceEventEnum.End,
            ReservationResource.ConferenceEventEnum.Join,
            ReservationResource.ConferenceEventEnum.Leave,
            ReservationResource.ConferenceEventEnum.Mute,
            ReservationResource.ConferenceEventEnum.Hold
        }.ToList ();

        var reservation = ReservationResource.Update (
          instruction: "conference",
          pathWorkspaceSid : acceptCallTaskParameters.WorkspaceSid,
          conferenceStatusCallback : statusCallback,
          conferenceStatusCallbackMethod : HttpMethod.Post,
          conferenceStatusCallbackEvent : conferenceStatusCallbackEvent,
          pathTaskSid : acceptCallTaskParameters.TaskSid,
          pathSid : acceptCallTaskParameters.ReservationSid,
          from : acceptCallTaskParameters.From,
          startConferenceOnEnter : true,
          endConferenceOnExit : true
        );

        return Ok (new { reservation = reservation });
      } catch (Exception e) {
        return Ok (new { error = e });
      }
    }

    public class AddPartyParameters {
      public String AccountSid;
      public String AuthToken;
      public String ConferenceSid;
      public String From;
      public String To;
    }

    [HttpPost ("/addParty")]
    public IActionResult addParty ([FromBody] AddPartyParameters addPartyParameters) {
      TwilioClient.Init (addPartyParameters.AccountSid, addPartyParameters.AuthToken);
      var participant = ParticipantResource.Create (
        from: addPartyParameters.From,
        to: addPartyParameters.To,
        pathConferenceSid: addPartyParameters.ConferenceSid,
        endConferenceOnExit: true
      );
      return Ok ();
    }

    public class OutboundParameters {
      public String AccountSid;
      public String AuthToken;
      public String WorkflowSid;
      public String WorkSpaceSid;
      public String to;
      public String from;
      public String OutboundNumber;
      public String FriendlyName;
      public String ConferenceSid;
    }

    [HttpPost ("/OutboundTask")]
    public IActionResult outboundTask ([FromBody] OutboundParameters outboundParameters) {
      TwilioClient.Init (outboundParameters.AccountSid, outboundParameters.AuthToken);

      dynamic attributes = new JObject ();
      attributes.outbound = true;
      var workers = WorkerResource.Read (
        friendlyName: outboundParameters.from,
        pathWorkspaceSid: outboundParameters.WorkSpaceSid
      );
      var worker = workers.First ();

      attributes.workerSid = worker.Sid;
      attributes.type = "phone";
      attributes.channel = "phone";
      attributes.WorkerName = worker.FriendlyName;
      attributes.from = outboundParameters.to;
      attributes.to = outboundParameters.OutboundNumber;
      attributes.originalAgent = outboundParameters.from;

      dynamic conference = new JObject ();
      conference.sid = outboundParameters.ConferenceSid;
      conference.friendlyName = outboundParameters.FriendlyName;
      attributes.conference = conference;

      var task = TaskResource.Create (
        attributes: attributes.ToString (),
        workflowSid: outboundParameters.WorkflowSid,
        pathWorkspaceSid: outboundParameters.WorkSpaceSid,
        taskChannel: "voice"
      );
      return Ok (new { taskSid = task.Sid });
    }

    public class GetCallerParameters {
      public String AccountSid;
      public String AuthToken;
      public String CallSid;
    }

    [HttpPost ("/GetCaller")]
    public IActionResult getCaller ([FromBody] GetCallerParameters getCallerParameters) {
      TwilioClient.Init (getCallerParameters.AccountSid, getCallerParameters.AuthToken);
      var call = CallResource.Fetch (pathSid: getCallerParameters.CallSid);
      return Ok (new { call = call });
    }

    public class PartiesParameters {
      public String AccountSid;
      public String AuthToken;
      public String WorkspaceSid;
      public String TaskSid;
    }

    [HttpPost ("/GetParties")]
    public IActionResult getParties ([FromBody] PartiesParameters partiesParameters) {
      try {
        TwilioClient.Init (partiesParameters.AccountSid, partiesParameters.AuthToken);
        var task = TaskResource.Fetch (
          pathWorkspaceSid: partiesParameters.WorkspaceSid,
          pathSid: partiesParameters.TaskSid
        );
        return Ok (new { attributes = task.Attributes });
      } catch (Exception e) {
        return Ok (e);
      }
    }

    public class HeldParticipantsParameters {
      public String AccountSid;
      public String AuthToken;
      public String ConferenceSid;
    }

    [HttpPost ("/GetHeldParticipants")]
    public IActionResult getHeldParticipants ([FromBody] HeldParticipantsParameters heldParticipantsParameters) {
      try {
        TwilioClient.Init (heldParticipantsParameters.AccountSid, heldParticipantsParameters.AuthToken);

        var participants = ParticipantResource.Read (
          pathConferenceSid: heldParticipantsParameters.ConferenceSid,
          hold: true
        );
        return Ok (new { participants = participants });
      } catch (Exception e) {
        return NotFound (e);
      }
    }

    public class AddConferenceSidParameters {
      public String AccountSid;
      public String AuthToken;
      public String WorkSpaceSid;
      public String TaskSid;
      public String ConferenceSid;
    }

    [HttpPost ("/AddConferenceSid")]
    public IActionResult addConferenceSid ([FromBody] AddConferenceSidParameters addConferenceSidParameters) {
      try {
        TwilioClient.Init (addConferenceSidParameters.AccountSid, addConferenceSidParameters.AuthToken);

        var task = TaskResource.Fetch(
          pathWorkspaceSid: addConferenceSidParameters.WorkSpaceSid,
          pathSid: addConferenceSidParameters.TaskSid
        );
        dynamic attributes = JObject.Parse(task.Attributes);
        attributes.conference.sid = addConferenceSidParameters.ConferenceSid;
        task = TaskResource.Update(
          pathWorkspaceSid: addConferenceSidParameters.WorkSpaceSid,
          pathSid: addConferenceSidParameters.TaskSid,
          attributes: attributes.ToString()
        );
        return Ok (new {task = task });
      } catch (Exception e) {
        return NotFound (e);
      }
    }

    public class AddConferenceNameParameters {
      public String AccountSid;
      public String AuthToken;
      public String WorkSpaceSid;
      public String TaskSid;
      public String ConferenceName;
    }

    [HttpPost ("/AddConferenceName")]
    public IActionResult addConferenceName ([FromBody] AddConferenceNameParameters addConferenceNameParameters) {
      try {
        TwilioClient.Init (addConferenceNameParameters.AccountSid, addConferenceNameParameters.AuthToken);

        var task = TaskResource.Fetch(
          pathWorkspaceSid: addConferenceNameParameters.WorkSpaceSid,
          pathSid: addConferenceNameParameters.TaskSid
        );
        dynamic attributes = JObject.Parse(task.Attributes);
        attributes.conference.friendlyName = addConferenceNameParameters.ConferenceName;
        task = TaskResource.Update(
          pathWorkspaceSid: addConferenceNameParameters.WorkSpaceSid,
          pathSid: addConferenceNameParameters.TaskSid,
          attributes: attributes.ToString()
        );
        return Ok (new { task = task });
      } catch (Exception e) {
        return NotFound (e);
      }
    }

    public class RemovePartyParameters {
      public String AccountSid;
      public String AuthToken;
      public String ConferenceSid;
      public String CallSid;
    }

    [HttpPost ("/RemoveParty")]
    public IActionResult removeParty ([FromBody] RemovePartyParameters removePartyParameters) {
      try {
        TwilioClient.Init (removePartyParameters.AccountSid, removePartyParameters.AuthToken);
        ParticipantResource.Update (
          endConferenceOnExit: false,
          pathConferenceSid: removePartyParameters.ConferenceSid,
          pathCallSid: removePartyParameters.CallSid
        );
        var participant = ParticipantResource.Delete (
          pathConferenceSid: removePartyParameters.ConferenceSid,
          pathCallSid: removePartyParameters.CallSid
        );
        return Ok (new { participanmt = participant });
      } catch (Exception e) {
        return Ok (e);
      }
    }

    public class HoldPartyParameters {
      public String AccountSid;
      public String AuthToken;
      public String ConferenceSid;
      public String CallSid;
    }

    [HttpPost ("/HoldParty")]
    public IActionResult holdParty ([FromBody] HoldPartyParameters holdPartyParameters) {
      try {
        TwilioClient.Init (holdPartyParameters.AccountSid, holdPartyParameters.AuthToken);
        var participant = ParticipantResource.Fetch (
          pathConferenceSid: holdPartyParameters.ConferenceSid,
          pathCallSid: holdPartyParameters.CallSid
        );
        ParticipantResource.Update (
          hold: !participant.Hold,
          pathConferenceSid : holdPartyParameters.ConferenceSid,
          pathCallSid : holdPartyParameters.CallSid
        );
        return Ok (new { participanmt = participant });
      } catch (Exception e) {
        return Ok (e);
      }
    }

    public class MutePartyParameters {
      public String AccountSid;
      public String AuthToken;
      public String ConferenceSid;
      public String CallSid;
      public bool Mute;
    }

    [HttpPost ("/MuteParty")]
    public IActionResult muteParty ([FromBody] MutePartyParameters mutePartyParameters) {
      try {
        TwilioClient.Init (mutePartyParameters.AccountSid, mutePartyParameters.AuthToken);
        var participant = ParticipantResource.Update (
          muted: mutePartyParameters.Mute,
          pathConferenceSid: mutePartyParameters.ConferenceSid,
          pathCallSid: mutePartyParameters.CallSid
        );
        return Ok (new { participanmt = participant });
      } catch (Exception e) {
        return Ok (e);
      }
    }

    public class GetConferenceParameters {
      public string AccountSid;
      public string AuthToken;
      public string FriendlyName;
    }

    [HttpPost ("/GetConferenceSid")]
    public IActionResult getConferenceSid ([FromBody] GetConferenceParameters conferenceParameters) {
      TwilioClient.Init (conferenceParameters.AccountSid, conferenceParameters.AuthToken);
      var conferences = ConferenceResource.Read (
        friendlyName: conferenceParameters.FriendlyName,
        status: ConferenceResource.StatusEnum.InProgress,
        limit: 20
      );
      foreach (var record in conferences) {
        Console.WriteLine (record.Sid);
        return Ok (new { conferenceSid = record.Sid });
      }
      return NotFound ();
    }

    public class TransferParameters {
      public string accountSid;
      public string authToken;
      public string workspaceSid;
      public string workflowSid;
      public string to;
      public string from;
      public string outboundNumber;
      public bool isBlind;
      public bool isInternal;
      public string taskSid;
      public string conferenceSid;
      public string workerCallSid;
    }

    [HttpPost ("/Transfer")]
    public IActionResult transfer ([FromBody] TransferParameters transferParameters) {
      bool transfered = false;
      try {
        TwilioClient.Init (transferParameters.accountSid, transferParameters.authToken);
        if (transferParameters.isBlind == true) { // Blind Transfer
          // Removing agent
          ParticipantResource.Update (
            endConferenceOnExit: false,
            pathConferenceSid: transferParameters.conferenceSid,
            pathCallSid: transferParameters.workerCallSid
          );
          ParticipantResource.Delete (
            pathConferenceSid: transferParameters.conferenceSid,
            pathCallSid: transferParameters.workerCallSid
          );
        }
        if (transferParameters.isInternal) {
          // Creating new task
          var task = TaskResource.Fetch (
            pathWorkspaceSid: transferParameters.workspaceSid,
            pathSid: transferParameters.taskSid
          );
          dynamic attributes = JObject.Parse (task.Attributes);
          attributes.blindTransfer = transferParameters.isBlind;
          attributes.workerSid = transferParameters.to;
          // if (transferParameters.isBlind == false) {
          //   attributes.from = transferParameters.from;
          // }
          attributes.outbound = "";
          attributes.Remove ("outbound");
          string conferenceSid = attributes.conference.sid;
          // Internal Transfer
          TaskResource.Create (
            attributes: attributes.ToString (),
            workflowSid: transferParameters.workflowSid,
            pathWorkspaceSid: transferParameters.workspaceSid
          );
        } else {
          // External Transfer
          ParticipantResource.Create (
            from: transferParameters.outboundNumber,
            to: transferParameters.to,
            endConferenceOnExit: false,
            pathConferenceSid: transferParameters.conferenceSid
          );
        }
        return Ok (transfered);
      } catch (Exception e) {
        return Ok (e);
      }
    }

    public class ConferenceParameters {
      public string accountSid;
      public string authToken;
      public string workspaceSid;
      public string workflowSid;
      public string to;
      public string from;
      public string outboundNumber;
      public bool isInternal;
      public string taskSid;
      public string conferenceSid;
      public string workerCallSid;
    }

    [HttpPost ("/Conference")]
    public IActionResult conference ([FromBody] ConferenceParameters conferenceParameters) {
      try {
        TwilioClient.Init (conferenceParameters.accountSid, conferenceParameters.authToken);
        if (conferenceParameters.isInternal) {
          // Creating new task
          var task = TaskResource.Fetch (
            pathWorkspaceSid: conferenceParameters.workspaceSid,
            pathSid: conferenceParameters.taskSid
          );
          dynamic attributes = JObject.Parse (task.Attributes);
          attributes.blindTransfer = "";
          attributes.Remove ("blindTransfer");
          attributes.workerSid = conferenceParameters.to;
          attributes.conferencing = true;
          attributes.outbound = "";
          attributes.Remove ("outbound");
          string conferenceSid = attributes.conference.sid;
          // Internal Conference
          TaskResource.Create (
            attributes: attributes.ToString (),
            workflowSid: conferenceParameters.workflowSid,
            pathWorkspaceSid: conferenceParameters.workspaceSid
          );
        } else { // External Conference
          ParticipantResource.Create (
            from: conferenceParameters.outboundNumber,
            to: conferenceParameters.to,
            endConferenceOnExit: false,
            pathConferenceSid: conferenceParameters.conferenceSid
          );
        }
        return Ok ();
      } catch (Exception e) {
        return Ok (e);
      }
    }

    public class EndConferenceOnExitParameters {
      public string accountSid;
      public string authToken;
      public string conferenceSid;
      public bool endConferenceOnExit;
    }

    [HttpPost ("/EndConferenceOnExit")]
    public IActionResult endConferenceOnExit ([FromBody] EndConferenceOnExitParameters endConferenceOnExitParameters) {
      try {
        TwilioClient.Init (endConferenceOnExitParameters.accountSid, endConferenceOnExitParameters.authToken);
        var participants = ParticipantResource.Read (
          pathConferenceSid: endConferenceOnExitParameters.conferenceSid,
          limit: 20
        );
        foreach (var participant in participants) {
          Console.WriteLine (participant);
          ParticipantResource.Update (
            endConferenceOnExit: endConferenceOnExitParameters.endConferenceOnExit,
            pathConferenceSid: endConferenceOnExitParameters.conferenceSid,
            pathCallSid: participant.CallSid
          );
        }
        return Ok ();
      } catch (Exception e) {
        return NotFound (e);
      }
    }

    public class AcceptConferenceParameters {
      public string accountSid;
      public string authToken;
      public string workSpaceSid;
      public string taskSid;
      public string conferenceSid;
      public string workerFriendlyName;
      public string from;
    }

    [HttpPost ("/acceptConference")]
    public IActionResult acceptConference ([FromBody] AcceptConferenceParameters acceptConferenceParameters) {
      try {
        TwilioClient.Init (acceptConferenceParameters.accountSid, acceptConferenceParameters.authToken);
        var participant = ParticipantResource.Create (
          from: acceptConferenceParameters.from,
          to: acceptConferenceParameters.workerFriendlyName,
          endConferenceOnExit: false,
          pathConferenceSid: acceptConferenceParameters.conferenceSid
        );
      } catch (Exception e) {
        return Ok (e);
      }
      return Ok (true);
    }

    public class GetTaskParameters {
      public string AccountSid;
      public string AuthToken;
      public string WorkSpaceSid;
      public string TaskSid;
    }

    [HttpPost ("/GetConferenceFromTask")]
    public IActionResult GetConferenceFromTask ([FromBody] GetTaskParameters getTaskParameters) {
      TwilioClient.Init (getTaskParameters.AccountSid, getTaskParameters.AuthToken);

      var task = TaskResource.Fetch (
        pathWorkspaceSid: getTaskParameters.WorkSpaceSid,
        pathSid: getTaskParameters.TaskSid
      );

      dynamic attributes = JObject.Parse (task.Attributes);

      return Ok (new { conferenceSid = attributes.conference.sid });
    }

    public class TaskParameters {
      public string AccountSid;
      public string AuthToken;
      public string WorkSpaceSid;
      public string TaskSid;
      public string Reason;
    }

    [HttpPost ("/completeTask")]

    public IActionResult completeTask ([FromBody] TaskParameters taskParameters) {
      TwilioClient.Init (taskParameters.AccountSid, taskParameters.AuthToken);
      try {
        TaskResource.Update (
          assignmentStatus: TaskResource.StatusEnum.Completed,
          reason: taskParameters.Reason,
          pathWorkspaceSid: taskParameters.WorkSpaceSid,
          pathSid: taskParameters.TaskSid
        );
      } catch (Exception e) {
        return Ok (e);
      }
      return Ok (true);
    }
    
    [HttpPost ("/wrapUpTask")]
    public IActionResult wrapUpTask ([FromBody] TaskParameters taskParameters) {
      TwilioClient.Init (taskParameters.AccountSid, taskParameters.AuthToken);
      try {
        TaskResource.Update (
          assignmentStatus: TaskResource.StatusEnum.Wrapping,
          reason: taskParameters.Reason,
          pathWorkspaceSid: taskParameters.WorkSpaceSid,
          pathSid: taskParameters.TaskSid
        );
      } catch (Exception e) {
        return Ok (e);
      }
      return Ok (true);
    }

    public class TokenParam {
      public string AccountSid;
      public string AuthToken;
      public string WorkSpaceSid;
      public string DirectWorkflowSid;
      public string ChatServiceSid;
      public string ChatApiSid;
      public string ChatApiSecret;
      public string VoiceApplicationSid;

    }

    [HttpPost ("/CapabilityToken")]
    public IActionResult getCapabilityToken ([FromBody] TokenParam tokenParam) {
      accountSid = tokenParam.AccountSid;
      authToken = tokenParam.AuthToken;
      workspaceSid = tokenParam.WorkSpaceSid;
      directWorkflowSid = tokenParam.DirectWorkflowSid;
      chatServiceSid = tokenParam.ChatServiceSid;
      chatApiSid = tokenParam.ChatApiSid;
      chatApiSecret = tokenParam.ChatApiSecret;
      voiceApplicationSid = tokenParam.VoiceApplicationSid;
      
      TwilioClient.Init (tokenParam.AccountSid, tokenParam.AuthToken);

      var user = getUser ();
      var username = user.username.Replace ("@", "_at_").Replace (".", "_dot_");

      var worker = getWorker (username, user.userid);
      var taskRouterToken = getTaskRouterToken (username, worker);
      var voiceToken = getVoiceToken (username);

      return Ok (new {
        startingActivitySid = worker.ActivitySid,
          taskRouterToken = taskRouterToken,
          voiceToken = voiceToken,
          chatToken = getChatToken (username)
      });
    }
    private string getVoiceToken (string username) {
      var scopes = new HashSet<IScope> {
        new IncomingClientScope (username),
        new OutgoingClientScope (voiceApplicationSid)
      };
      var capability = new ClientCapability (accountSid, authToken, scopes : scopes);
      return capability.ToJwt ();
    }
    private string getTaskRouterToken (string username, WorkerResource worker) {
      var workerSid = worker.Sid;

      var updateActivityFilter = new Dictionary<string, Policy.FilterRequirement> { { "ActivitySid", Policy.FilterRequirement.Required }
        };

      var urls = new PolicyUrlUtils (workspaceSid, workerSid);

      var allowActivityUpdates = new Policy (urls.Worker,
        HttpMethod.Post,
        postFilter : updateActivityFilter);
      var allowTasksUpdate = new Policy (urls.AllTasks, HttpMethod.Post);
      var allowReservationUpdate = new Policy (urls.AllReservations, HttpMethod.Post);
      var allowWorkerFetches = new Policy (urls.Worker, HttpMethod.Get);
      var allowTasksFetches = new Policy (urls.AllTasks, HttpMethod.Get);
      var allowReservationFetches = new Policy (urls.AllReservations, HttpMethod.Get);
      var allowActivityFetches = new Policy (urls.Activities, HttpMethod.Get);

      var policies = new List<Policy> {
        allowActivityUpdates,
        allowTasksUpdate,
        allowReservationUpdate,
        allowWorkerFetches,
        allowTasksFetches,
        allowReservationFetches

      };
      var capability = new TaskRouterCapability (
        accountSid,
        authToken,
        workspaceSid,
        workerSid,
        policies : policies,
        expiration : DateTime.UtcNow.AddSeconds (8 * 60 * 60));

      return capability.ToJwt ();
    }
    private string getChatToken (string username) {

      if (chatApiSid != "" && chatApiSecret != "") {
        var grant = new ChatGrant {
        ServiceSid = chatServiceSid
        };

        var grants = new HashSet<IGrant> { { grant }
        };
        var token = new Token (
          accountSid,
          chatApiSid,
          chatApiSecret,
          username,
          grants : grants);
        return token.ToJwt ();
      }
      return "";

    }
    private WorkerResource getWorker (string username, Guid userId) {
      var workers = WorkerResource.Read (
        friendlyName: username,
        pathWorkspaceSid: workspaceSid
      );
      if (workers.Any ()) {
        return workers.First ();
      } else {
        var attributes = JsonConvert.SerializeObject (new Dictionary<string, Object> () { { "contact_uri", "client:" + username }, { "worker_id", userId.ToString () }
        }, Formatting.Indented);
        var worker = WorkerResource.Create (
          friendlyName: username,
          pathWorkspaceSid: workspaceSid,
          attributes: attributes
        );
        return worker;
      }
    }
    private User getUser () {
      HttpWebRequest webRequest = (HttpWebRequest) WebRequest.Create (apiUrl + "/api/Me");
      webRequest.CookieContainer = new CookieContainer ();
      webRequest.CookieContainer.Add (new Cookie ("access_token", Request.Cookies["access_token"], "/", apiDomain));
      using (Stream receiveStream = webRequest.GetResponse ().GetResponseStream ()) {
        using (StreamReader reader = new StreamReader (receiveStream, Encoding.UTF8)) {
          string response = reader.ReadToEnd ();
          return JsonConvert.DeserializeObject<User> (response);
        }
      }
    }

    public class SMSParameters {
      public string to;
      public string from;
      public string accountSid;
      public string authToken;
    }

    [HttpPost ("/Outboundsms")]
    public IActionResult outboundSMS ([FromBody] SMSParameters smsParameters) {
      System.Diagnostics.Debug.WriteLine ($"\r\n\r\nTo: {smsParameters.to}\r\nFrom: {smsParameters.from}\r\n\r\n");

      Twilio.TwilioClient.Init (smsParameters.accountSid, smsParameters.authToken);

      var execution = ExecutionResource.Create (
        to: new Twilio.Types.PhoneNumber (smsParameters.to),
        from: new Twilio.Types.PhoneNumber (smsParameters.from),
        pathFlowSid: "FW543eb3694b194f13589f0ede9512b962"
      ); // Hardcoded value should be changed when outbound is finished
      System.Diagnostics.Debug.WriteLine ($"\r\n\r\nExecution: {execution}\r\n\r\n");
      return Ok (execution);
    }
  }
}
class PolicyUrlUtils {
  const string taskRouterBaseUrl = "https://taskrouter.twilio.com";
  const string taskRouterVersion = "v1";

  readonly string _workspaceSid;
  readonly string _workerSid;

  public PolicyUrlUtils (string workspaceSid, string workerSid) {
    _workspaceSid = workspaceSid;
    _workerSid = workerSid;
  }

  public string AllTasks => $"{Workspace}/Tasks/**";

  public string Worker => $"{Workspace}/Workers/{_workerSid}";

  public string AllReservations => $"{Worker}/Reservations/**";

  public string Workspace =>
    $"{taskRouterBaseUrl}/{taskRouterVersion}/Workspaces/{_workspaceSid}";

  public string Activities => $"{Workspace}/Activities";
}