;(() => {
  const express = require('express');

  const router = new express.Router();

  const uniqueId = require('../helpers/unique-id');
  const generateAccessToken = require('../helpers/generate-access-token');
  const saul = require('../helpers/call-saul');

  const ObjectID = require('mongodb').ObjectID;

  const jwt = require('jsonwebtoken');

  const JWT_SECRET = process.env.TRENDIFY_JWT_SECRET || 'secret';

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
            _id: v.id,
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
            { id: new ObjectID(trendSessionId) },
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
          trendSessions.findOne({ id: new ObjectID(trendSessionId) }, (error, record) => {
            if (error) {
              res.sendStatus(404);
              return;
            }
            if (record.creatorId === identity.id) {
              db.collection('sessions').remove({id: new ObjectID(trendSessionId)}, (_err, _record) => {
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
      const accessToken = authorization || generateAccessToken(uniqueIdentifier, roomId)

      jwt.verify(accessToken, JWT_SECRET, (err, token) => {
        if (err) {
          res.status(401).send(err);
          return;
        }

        trendSessions.insertOne({
          id: roomId,
          accessPasses: [],
          persistedUsers: {},
          creatorId: uniqueIdentifier
        }).then(result => {
          res.send({
            room_id: roomId,
            access_token: accessToken
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

      let accessPass = generateAccessToken(uniqueId(4), trendSessionId);

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

      const _query = {id: new ObjectID(trendSessionId)}

      trendSessions.findOne(_query, (error, record) => {
        if (error) {
          res.status(401).send(error);
          return;
        }

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
            creator_id: record.creatorId
          }

          res.send(safeSession);
        });
      });
    });

    io.on('connection', socket => {
      console.log('[socket] - ', socket.id, 'has connected.')

      socket.on('handshake', accessPass => {
        validate(accessPass)
          .then(response => {
            const {
              user_id,
              session_id
            } = response;

            const _query = { id: new ObjectID(session_id) };

            trendSessions.findOne(_query, (err, trendSession, r) => {
              console.log(trendSessionId, accessPass)
              if (err || !room) {
                socket.emit('entry-fail')
              } else {
                trendSession.persistedUsers = trendSession.persistedUsers || {};
                trendSession.persistedUsers[socket.id] = user_id;

                if (room.accessPasses.includes(accessPass)) {
                  console.log(`${user_id} joined room ${session_id}`);
                  trendSessions.update(_query, trendSession);
                  // delete room.hallpasses[hallpass]
                  socket.join(session_id);
                } else {
                  socket.emit('entry-fail')
                }
              }
            });
          }).catch(error => socket.emit('handshake-fail', error))
      });

      socket.on('update_state', (accessPass, state) => {
        jwt.verify(accessPass, JWT_SECRET, (error, identity) => {
          if (error) {
            return;
          }

          const {
            session_id,
            user_id
          } = identity;


        })
      });

      setInterval(() => {
        trendSessions.find({}, (err, trendSessions, r) => {
          trendSessions.forEach(trendSession => {
            const _query = {id: new ObjectID(trendSession.id)}
            const socketRoom = io.sockets.adapter.rooms[room.id];

            if (socketRoom) {
              const clients = Object.keys(socketRoom.sockets);
              const users = Object.keys(trendSession.persistedUsers);

              users.forEach(userKey => {
                if (!clients.includes(userKey)) {
                  delete room.users[userKey];
                }
              });
              trendSessions.update(_query, trendSession);
              io.to(trendSession.id).emit('update', {
                users: room.users
              });
            }
          })
        })
      }, 20000);

      socket.on('exit', session_id => {
        // Leave current room, and no longer maintain users hash
        socket.leave(session_id);

        const _query = {id: new ObjectID(session_id)}
        trendSessions.findOne(query, (err, trendSession, r) => {
          if (err || !room) {
          } else {
            delete room.users[socket.id];
            trendSessions.update(_query, room);
            setTimeout(
              () => io.to(session_id).emit('update', {users: room.users}),
              500
            );
          }
        });
      });

    });
    return router;
  };
})();
