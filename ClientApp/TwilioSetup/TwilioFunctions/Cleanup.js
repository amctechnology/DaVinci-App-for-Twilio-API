exports.handler = function (context, event, callback) {
  const client = context.getTwilioClient();

  function deleteAll() {
    return client.proxy
      .services(context.PROXY_SERVICE)
      .sessions.list({ limit: 20 })
      .then((sessions) => {
        const promises = [];
        sessions.forEach((s) =>
          promises.push(
            client.proxy
              .services(context.PROXY_SERVICE)
              .sessions(s.sid)
              .remove()
          )
        );
        return Promise.all(promises);
      })
      .then((response) =>
        client.chat
          .services(context.CHAT_SERVICE)
          .channels.list({ limit: 20 })
          .then((channels) => {
            const promises = [];
            channels.forEach((c) =>
              promises.push(
                client.chat
                  .services(context.CHAT_SERVICE)
                  .channels(c.sid)
                  .remove()
              )
            );
            return Promise.all(promises);
          })
      )
      .then(
        client.taskrouter
          .workspaces(context.WORKSPACE)
          .tasks.list({ limit: 20 })
          .then((tasks) => {
            const promises = [];
            tasks.forEach((t) =>
              promises.push(
                client.taskrouter
                  .workspaces(context.WORKSPACE)
                  .tasks(t.sid)
                  .remove()
              )
            );
            return Promise.all(promises);
          })
      );
  }

  deleteAll().then((response) => callback(null, 'Deleted'));
};
