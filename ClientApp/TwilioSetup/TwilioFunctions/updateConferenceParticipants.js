exports.handler = function (context, event, callback) {
  /**
   * This function marks the customer as  endConferenceOnExit such that when the customer
   * leaves the call the call will then end for the agent
   * Note: While we are passed the call id from the frontend we are not passed the conference id
   * therefore we must search all conferences to find the correct one
   * (we can probably skip retreieving all participants but then we have to deal with some
   * promises rejecting if it is the wrong conference id)
   * This method is not effective. In the future it might be better to create our own conference,
   * instead of using task router reservation.conference, since we could then pass the conference id
   */
  const client = context.getTwilioClient();
  client.conferences
    .list({
      status: 'in-progress'
    })
    .then((conferences) => {
      const promises = [];
      for (const conference of conferences) {
        promises.push(
          client
            .conferences(conference.sid)
            .participants.list()
            .then((participants) => {
              for (const participant of participants) {
                if (participant.callSid === event.CustomerCallSid) {
                  return client
                    .conferences(conference.sid)
                    .participants(participant.callSid)
                    .update({ endConferenceOnExit: true });
                }
              }
            })
        );
      }

      Promise.all(promises)
        .then(() => {
          callback(null, 'OK');
        })
        .catch((error) => console.log(error));
    });
};
