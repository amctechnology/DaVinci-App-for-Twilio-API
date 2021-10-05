exports.handler = function (context, event, callback) {
  console.log('Event: ' + JSON.stringify(event));
  const client = context.getTwilioClient();
  client.chat
    .services(context.CHAT_SERVICE)
    .channels(event.ChannelSid)
    .fetch()
    .then((channel) => {
      console.log('Channel: ' + channel.sid);
      console.log('channelAttributes: ' + JSON.stringify(channel));
      const channelAttributes = JSON.parse(channel.attributes);
      if (
        channelAttributes.type === 'sms' &&
        event.From !== channelAttributes.customerNumber
      ) {
        console.log('Sending Message!');
        console.log({
          body: event.Body,
          to: channelAttributes.customerNumber,
          from: channelAttributes.twilioNumber
        });
        return client.messages
          .create({
            body: event.Body,
            to: channelAttributes.customerNumber,
            from: channelAttributes.twilioNumber
          })
          .then(() => console.log('Message sent!'));
      }
    })
    .then(() => callback(null, null));
};
