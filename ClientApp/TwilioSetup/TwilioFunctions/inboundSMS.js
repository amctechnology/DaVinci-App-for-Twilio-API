exports.handler = function (context, event, callback) {
  const from = event.from;
  const to = event.to;
  const body = event.body;
  const friendlyName = from.replace(/[^0-9a-zA-Z]/g, '');
  const client = context.getTwilioClient();
  console.log(event);
  console.log(friendlyName);

  function createTask(channelSid, proxySid) {
    return client.taskrouter
      .workspaces(context.WORKSPACE)
      .tasks.create({
        attributes: JSON.stringify({
          taskChannel: 'sms',
          type: 'sms',
          from: from,
          channelSid: channelSid,
          proxySid: proxySid
        }),
        workflowSid: context.WORKFLOW
      })
      .then((task) => console.log('Task Created'));
  }

  function createProxyParticipant(session, name, id) {
    return client.proxy
      .services(context.PROXY_SERVICE)
      .sessions(session.sid)
      .participants.create({ friendlyName: name, identifier: id });
  }

  function createProxySession(channelSid) {
    const proxyService = client.proxy.services(context.PROXY_SERVICE);
    return proxyService.sessions
      .create({
        mode: 'message-only'
      })
      .then((session) => {
        console.log('Created proxy session');
        return createProxyParticipant(session, 'Customer', from)
          .then((participant) => {
            console.log('Created customer participant');
            /* return client.proxy.services(context.PROXY_SERVICE)
              .sessions(session.sid)
              .participants
              .list({limit: 20})
              .then(participants => console.log("participants: " + participants.length)); */
            return createProxyParticipant(session, 'Channel', channelSid).then(
              () => {
                console.log('Created channel participant');
              }
            );
          })
          .then((response) => session);
      });
  }

  function createChannel() {
    return client.chat
      .services(context.CHAT_SERVICE)
      .channels.create({
        friendlyName: friendlyName,
        uniqueName: friendlyName,
        attributes: JSON.stringify({
          type: 'sms',
          twilioNumber: to,
          customerNumber: from
        })
      })
      .then((channel) => {
        console.log('Created chat channel');
        return createProxySession(channel.sid)
          .then((proxySession) => createTask(channel.sid, proxySession.sid))
          .then((task) => channel);
      });
  }

  function getChannel() {
    return client.chat
      .services(context.CHAT_SERVICE)
      .channels(friendlyName)
      .fetch()
      .then((channel) => {
        console.log('Channel found');
        return channel;
      })
      .catch((error) => {
        console.log('Channel not found');
        return createChannel();
      });
  }

  getChannel()
    .then((channel) =>
      client.chat
        .services(context.CHAT_SERVICE)
        .channels(channel.sid)
        .messages.create({
          body: body,
          from: from
        })
    )
    .catch((error) => console.log(error))
    .then((response) => callback(null, null));
  /*
              get channel
              if !channel
                  create channel
                  create proxy
                  create task
              post message to channel
          */
};
