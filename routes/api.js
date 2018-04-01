;(() => {
  const express = require('express');

  const router = new express.Router();

  const uniqueId = require('../helpers/unique-id');
  const generateaccessPass = require('../helpers/generate-access-token');
  const callSaul = require('../helpers/call-saul');
  const nextWord = require('../helpers/next-word');

  const jwt = require('jsonwebtoken');

  const JWT_SECRET = process.env.TRENDIFY_JWT_SECRET || 'secret';

  const gameSessions = {}

  module.exports = (db, io) => {
    console.log('[module] api/')
    const userSessions = db.collection('userSessions');
    const trendSessions = db.collection('trendSessions');

    const validate = token => {
      return new Promise((resolve, reject) => {
        jwt.verify(token, JWT_SECRET,
          (err, result) => err ? reject(err) : resolve(result)
        )
      });
    }

    // Get available sessions filterable by query params
    router.get('/sessions', (req, res) => {
      trendSessions.find({}).toArray((error, values) => {
        if (err) {
          res.status(500).send(error);
          return;
        }

        const sanitizedValues = values.map(value => {
          return {
            id: v.id,
            creator_id: v.creatorId
          };
        })
        res.send(sanitizedValues);
      })
    });

    // Retrieve a specific session by unique identifier
    router.get('/sessions/:id', (req, res) => {
      const {
        authorization
      } = req.headers;

      const trendSessionId = req.params.id;

      validate(authorization)
        .then(identity => {
          trendSessions.findOne(
            { id: trendSessionId },
            (err, record) => res.send(record)
          )
        }).catch(error => res.status(401).send(error));
    });

    router.delete('/sessions/:id', (req, res) => {
      const {
        authorization
      } = req.headers;

      const trendSessionId = req.params.id;

      validate(authorization)
        .then(identity => {
          trendSessions.findOne({ id: trendSessionId }, (error, record) => {
            if (error) {
              res.sendStatus(404);
              return;
            }
            if (record.creatorId === identity.id) {
              trendSessions.remove({id: trendSessionId}, (_err, _record) => {
                if (_err) {
                  res.status(401).send(_err);
                  return;
                }
                res.send(_record);
              })
              return;
            }
            res.sendStatus(401);
          })
        }).catch(error => res.status(401).send(error));
    });

    // Request will return session id
    router.post('/sessions/create', (req, res) => {
      const {
        body,
        headers
      } = req;

      const {
        authorization
      } = headers;

      const roomId = uniqueId(4);
      const uniqueIdentifier = uniqueId(4);
      const accessPass = authorization || generateaccessPass(uniqueIdentifier, roomId)

      jwt.verify(accessPass, JWT_SECRET, (err, token) => {
        if (err) {
          res.status(401).send(err);
          return;
        }

        gameSessions[roomId] = {
          state: 'lobby',
          num_rounds: 5,
          current_round: 0,
          round_timeout: 60000,
          host_id: token.user_id,
          challenge_word: null,
          players: {

          }
        };

        trendSessions.insertOne({
          id: roomId,
          accessPasses: [],
          persistedUsers: {},
          creatorId: token.user_id
        }).then(result => {
          res.send({
            room_id: roomId,
            access_token: accessPass
          });
        });

      });
    });

    // Heimdall
    // Gateway into a socket
    // Grants access by generating a hallpass
    // https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html
    router.put('/sessions/join/:id', (req, res) => {
      const params = req.params;
      const trendSessionId = params.id;

      const {
        authorization
      } = req.headers;

      let accessPass = generateaccessPass(uniqueId(4), trendSessionId);

      if (authorization) {
        const parsedAccessPass = jwt.verify(accessPass, JWT_SECRET);

        try {
          const decodedProvidedToken = jwt.verify(authorization, JWT_SECRET);
          accessPass = jwt.sign(
            Object.assign(parsedAccessPass, decodedProvidedToken),
            JWT_SECRET
          );
        } catch (err) {
          res.status(401).send(error);
          return;
        }
      }

      const parsedAccessPass = jwt.verify(accessPass, JWT_SECRET);
      const _query = { id: trendSessionId }

      trendSessions.findOne(_query, (error, record) => {
        if (error) {
          res.status(401).send(error);
          return;
        }

        gameSessions[trendSessionId] = gameSessions[trendSessionId] || {
          state: 'lobby',
          num_rounds: 5,
          current_round: 0,
          round_timeout: 60000,
          host_id: record.creatorId,
          challenge_word: null,
          players: {

          }
        };

        const allowedUsers = record.accessPasses;

        record.accessPasses.push(accessPass);

        trendSessions.update(_query, record, (update_err) => {
          if (update_err) {
            res.status(401).send(update_error);
            return;
          }

          const safeSession = {
            id: record.id,
            access_pass: accessPass,
            creator_id: record.creatorId,
            user_id: parsedAccessPass.user_id
          }

          res.send(safeSession);
        });
      });
    });

    io.on('connection', socket => {
      console.log('[socket] - connection ', socket.id, 'has connected.')

      socket.on('handshake', accessPass => {
        console.log('[socket] - handshake', accessPass);
        validate(accessPass)
          .then(response => {
            const {
              user_id,
              session_id
            } = response;

            const _query = { id: session_id };

            trendSessions.findOne(_query, (err, trendSession, r) => {
              console.log(session_id, accessPass)
              if (err || !trendSession) {
                socket.emit('entry-fail')
              } else {
                trendSession.persistedUsers = trendSession.persistedUsers || {};
                trendSession.persistedUsers[socket.id] = user_id;

                if (trendSession.accessPasses.includes(accessPass)) {
                  console.log(`UserId[${user_id}] joined room ${session_id}`);
                  trendSessions.update(_query, trendSession);
                  // delete trendSession.hallpasses[hallpass]
                  socket.join(session_id);
                  socket.emit('entry-success', user_id);

                  gameSessions[session_id] = gameSessions[session_id] || {
                    state: 'lobby',
                    num_rounds: 5,
                    current_round: 0,
                    round_timeout: 60000,
                    host_id: trendSession.creatorId,
                    challenge_word: null,
                    players: {

                    }
                  };

                  let player = gameSessions[session_id].players[user_id];

                  if (user_id === trendSession.creatorId) {
                      player = {
                        name: 'host'
                      };
                      gameSessions[session_id].players[user_id] = player;
                  }

                  if (player) {
                    socket.emit('update', {
                      type: 'user',
                      name: player.name,
                      user_id
                    });
                  } else {
                    socket.emit('should-enroll', user_id);
                  }

                  const mappedPlayers = Object.keys(gameSessions[session_id].players)
                    .filter(uid => uid !== gameSessions[session_id].host_id)
                    .filter(uid => !!gameSessions[session_id].players[uid].name)
                    .map(uid => gameSessions[session_id].players[uid])

                  io.to(session_id).emit('update', {
                    type: 'users',
                    users: mappedPlayers
                  });

                } else {
                  socket.emit('entry-fail')
                }
              }
            });
          }).catch(error => socket.emit('entry-fail', error))
      });

      const update_state = (state, session_id) => {
        gameSessions[session_id].state = state;
        io.to(session_id).emit('update', {
          type: 'state',
          state
        });

        if (state === 'lobby') {
          return;
        }

        if (state === 'round') { // round start, play it through
          const mappedPlayerIds = Object.keys(gameSessions[session_id].players)
            .filter(uid => uid !== gameSessions[session_id].host_id)
            .filter(uid => !!gameSessions[session_id].players[uid].vote)

          console.log(mappedPlayerIds);

          mappedPlayerIds.forEach(uid => {
            console.log('update_state', 'gameSessions[session_id].players[uid]', gameSessions[session_id].players[uid])
            gameSessions[session_id].players[uid].vote = null;
          });

          const roundTimeout = gameSessions[session_id].round_timeout;
          const numberRounds = gameSessions[session_id].num_rounds;
          const currentRound = gameSessions[session_id].current_round;

          console.log('roundTimeout', roundTimeout);
          let endsAt = new Date();
          endsAt.setMilliseconds(endsAt.getMilliseconds() + roundTimeout)
          console.log(+endsAt)

          const challengeWord = nextWord();

          io.to(session_id).emit('update', {
            type: 'challenge',
            word: challengeWord
          });

          io.to(session_id).emit('update', {
            type: 'round_number',
            round_number: currentRound,
            total_rounds: numberRounds,
            ends_at: +endsAt
          });

          gameSessions[session_id].challenge_word = challengeWord;


          gameSessions[session_id].intermission_timeout = setTimeout(
            () => update_state('intermission', session_id),
            roundTimeout
          );
          return;
        }

        if (state === 'intermission') { // in between rounds
          const mappedPlayerVotes = Object.keys(gameSessions[session_id].players)
            .filter(uid => uid !== gameSessions[session_id].host_id)
            .filter(uid => !!gameSessions[session_id].players[uid].vote)
            .map(uid => gameSessions[session_id].players[uid].vote);

          console.log('update_state - callSaul', mappedPlayerVotes);

          callSaul(mappedPlayerVotes).then(trendsApiResult => {
            let parsedTrendResults = {};

            try {
              parsedTrendResults = JSON.parse(trendsApiResult);
              console.log(parsedTrendResults);
            } catch (err) {
              console.log('ParseError[Saul]', err);
            }

            const mappedPlayerIds = Object.keys(gameSessions[session_id].players)
              .filter(uid => uid !== gameSessions[session_id].host_id)
              .filter(uid => !!gameSessions[session_id].players[uid].vote);

            mappedPlayerIds.forEach(uid => {
              const vote = gameSessions[session_id].players[uid].vote;
              const indexOfVote = mappedPlayerVotes.indexOf(vote);
              const scoreForVote = parsedTrendResults.default.averages[indexOfVote] || 0;

              const oldScore = gameSessions[session_id].players[uid].score || 0;
              gameSessions[session_id].players[uid].score = oldScore + scoreForVote;
            });

            const mappedUsers = Object.keys(gameSessions[session_id].players)
              .filter(uid => uid !== gameSessions[session_id].host_id)
              .map(uid => gameSessions[session_id].players[uid])

            io.to(session_id).emit('update', {
              type: 'users',
              users: mappedUsers
            });

            io.to(session_id).emit('update', {
              type: 'trend_data',
              labels: mappedPlayerVotes,
              data: parsedTrendResults
            });
          });

          return;
        }
      }

      socket.on('enroll', (accessPass, name) => {
        console.log('[socket] - enroll', accessPass, name);
        jwt.verify(accessPass, JWT_SECRET, (error, identity) => {
          if (error) {
            console.log(error);
            return;
          }

          const {
            session_id,
            user_id
          } = identity;

          const player = gameSessions[session_id].players[user_id] || {};
          player.name = name;
          gameSessions[session_id].players[user_id] = player;

          const mappedPlayers = Object.keys(gameSessions[session_id].players)
            .filter(uid => uid !== gameSessions[session_id].host_id)
            .map(uid => gameSessions[session_id].players[uid])

          socket.emit('update', {
            type: 'user',
            name: player.name,
            user_id
          });

          io.to(session_id).emit('update', {
            type: 'users',
            users: mappedPlayers
          });
        })
      });

      socket.on('game_start', (accessPass) => {
        console.log('[socket] - game_start', accessPass);
        jwt.verify(accessPass, JWT_SECRET, (error, identity) => {
          if (error) {
            console.log(error);
            return;
          }
          console.log('[event] game_start | ', JSON.stringify(identity, null, 2))
          const {
            session_id,
            user_id
          } = identity;

          const _query = { id: session_id };
          trendSessions.findOne(_query, (error, record) => {
            console.log(user_id, record);
            if (user_id === record.creatorId) {
              update_state('round', session_id);
            }
          });
        });
      });

      socket.on('update_state', (accessPass, state) => {
        console.log('[socket] - update_state', accessPass, state);
        jwt.verify(accessPass, JWT_SECRET, (error, identity) => {
          if (error) {
            console.log(error);
            return;
          }

          const {
            session_id,
            user_id
          } = identity;

          const _query = { id: session_id };
          trendSessions.findOne(_query, (error, record) => {
            if (user_id === record.creatorId) {
              update_state(state, session_id);
            }
          });
        });
      });

      socket.on('vote', (accessPass, keyword) => {
        console.log('[socket] - vote', accessPass, keyword);

        jwt.verify(accessPass, JWT_SECRET, (error, identity) => {
          if (error) {
            console.log(error);
            return;
          }

          const {
            session_id,
            user_id
          } = identity;

          const gameSession = gameSessions[session_id];

          if (!keyword.includes(gameSession.challenge_word)) {
            socket.emit('update', {
              type: 'vote_failure',
              attempt: keyword
            })
            return;
          }

          const player = gameSessions[session_id].players[user_id] || {};
          player.vote = keyword;

          gameSessions[session_id].players[user_id] = player;

          const mappedPlayers = Object.keys(gameSessions[session_id].players)
            .filter(uid => uid !== gameSessions[session_id].host_id)
            .map(uid => gameSessions[session_id].players[uid]);

          console.log('mappedUsers@before.every', mappedUsers);
          if (mappedUsers.every(user => !!user.vote)) {
            clearTimeout(gameSessions[session_id].intermission_timeout);
            update_state('intermission', session_id);
          }

          io.to(session_id).emit('update', {
            type: 'users',
            users: mappedPlayers
          });

        });
      });

      socket.on('exit', accessPass => {
        console.log('[socket] - exit', accessPass);
        jwt.verify(accessPass, JWT_SECRET, (error, record) => {
          if (error) {
            return;
          }

          const {
            user_id,
            session_id
          } = record;

          // Leave current room, and no longer maintain users hash
          socket.leave(session_id);

          delete gameSessions[session_id].players[user_id];

          const mappedPlayers = Object.keys(gameSessions[session_id].players)
            .filter(uid => uid !== gameSessions[session_id].host_id)
            .map(uid => gameSessions[session_id].players[uid]);

          io.to(session_id).emit('update', {
            type: 'users',
            users: mappedPlayers
          });
        });
      });

    });
    return router;
  };
})();
