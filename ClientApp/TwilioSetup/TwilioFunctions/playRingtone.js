exports.handler = function (context, event, callback) {
  const twiml = new Twilio.twiml.VoiceResponse();
  twiml.play(
    {
      loop: 0
    },
    `${context.URL}/assets/Phone_Ringing_8x-Mike_Koenig-696238708.mp3`
  );
  callback(null, twiml);
};
