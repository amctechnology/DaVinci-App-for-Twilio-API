exports.handler = function (context, event, callback) {
  const conferenceNamePreHash = Date.now() + event.phone;
  let conferenceName =
    require('crypto')
      .createHash('sha1')
      .update(conferenceNamePreHash)
      .digest('base64') + '';
  conferenceName = conferenceName.replace(/\//g, ''); // Removes forward slashes from conferenceName
  console.log('Creating Conference: ' + conferenceName);
  // Connect agent to conference
  const response = new Twilio.twiml.VoiceResponse();
  const dial = response.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      waitUrl: `${context.URL}/playRingtone`
    },
    conferenceName
  );

  // Add customer to conference
  const client = context.getTwilioClient();
  client
    .conferences(conferenceName)
    .participants.create({
      from: context.OUTBOUND_FROM,
      to: event.phone,
      startConferenceOnEnter: true,
      endConferenceOnExit: true,
      waitUrl: `${context.URL}/playRingtone`
    })
    .then((participant) => {
      console.log(participant.callSid);
      callback(null, response);
    })
    .catch((error) => console.log(error));
};
