exports.handler = async function (context, event, callback) {
  try {
    console.log(event.to);
    console.log(event.from);
    const client = context.getTwilioClient();
    await client.taskrouter
      .workspaces(context.WORKSPACE)
      .tasks.list({
        evaluateTaskAttributes: `type == "sms"`
      })
      .then(async (tasks) => {
        console.log('# of tasks in router ' + tasks.length);
        for (let i = 0; i < tasks.length; i++) {
          if (
            (JSON.parse(tasks[i].attributes).from === event.from,
            JSON.parse(tasks[i].attributes).to === event.to,
            JSON.parse(tasks[i].attributes).taskChannel === 'sms')
          ) {
            console.log('Task Exists');
            callback(null, 'true');
          }
        }
        console.log('No Task Exists');
        callback(null, 'false');
      });
  } catch (error) {
    console.log(error);
    callback(error);
  }
};
