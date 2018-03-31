(() => {
  const express = require('express');

  const router = new express.Router();

  const crypto = require('crypto');
  const ObjectID = require('mongodb').ObjectID;

  const assert = require('assert');
  const request = require('request');
  const jwt = require('jsonwebtoken');

  const JWT_SECRET = process.env.TRENDIFY_JWT_SECRET || 'secret';

  module.exports = (db, io) => {
    const userSessions = db.collection('userSessions');
    const trendSessions = db.collection('trendSessions');

    const validate = token => {
      return new Promise((resolve, reject) => {
        jwt.verify(token, JWT_SECRET,
          (err, result) => err ? reject(err) : resolve(result)
        )
      });
    }

    router.get('/authorize', (req, res) => {
      const token = req.query.token;
      validate(token)
        .then(result => res.send(result))
        .catch(error => res.status(401).send(error));
    });

    // Get available sessions filterable by query params
    router.get('/sessions', (req, res) => {
      const token = req.query.token
      validate(token).then(identity =>
        trendSessions.find({}).toArray((err, values) => {
          res.send(values.map(v => {
            let r = {}
            if (v.config.password) {
              r.password_protected = true;
            }
            return Object.assign(r, {
              _id: v._id,
              name: v.name,
              creatorId: v.creatorId
            })
          }))
        })
      )
    });

    // Retrieve a specific session by unique identifier
    router.get('/sessions/:id', (req, res) => {
      const token = req.query.token;
      const trendSessionId = req.params.id;

      validate(token)
        .then(identity => {
          trendSessions.findOne(
            { _id: new ObjectID(trendSessionId) },
            (err, record) => res.send(record)
          )
        }).catch(error => res.status(401).send(error));
    });

    router.delete('/sessions/:id', (req, res) => {
      const token = req.query.token;
      const trendSessionId = req.params.id;

      validate(token)
        .then(identity => {
          trendSessions.findOne({ _id: new ObjectID(trendSessionId) }, (error, record) => {
            if (error) {
              res.sendStatus(404);
              return;
            }
            if (record.creatorId === result.attributes.id) {
              db.collection('sessions').remove({_id: new ObjectID(sessionId)}, (_err, _record) => {
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
      const body = req.body;
      const token = req.query.token;

      validate(token)
        .then(identity => {
          trendSessions.insertOne({
            name: body.name,
            accessPasses: [],
            persistedUsers: {},
            creatorId: result.id
          }).then(result => {
            const trendSessionId = result.insertedId;
            res.send({
              room_id: trendSessionId;
            })
          })
        }).catch(error => res.status(401).send(error));
    });
    // Heimdall
    // Gateway into a socket
    // Grants access by generating a hallpass
    // https://www.w3.org/Protocols/rfc2616/rfc2616-sec9.html
    router.put('/sessions/join', (req, res) => {
      const params = req.params;

      const token = req.query.token;
      const trendSessionId = params.sessionId;

      validate(token)
        .then(identity => {
          const accessPass = jwt.sign({
            user_id: identity.id,
            session_id: trendSessionId,
            exp: Math.floor(Date.now() / 1000) - 30
          }, JWT_SECRET);

          const _query = {_id: new ObjectID(trendSessionId)}

          roomSessions.findOne(_query, (error, record) => {
            if (error) {
              res.status(401).send(error);
              return;
            }

            const allowedUsers = record.accessPasses;

            record.accessPasses.push(accessPass);

            trendSessions.update(query, record, (update_err) => {
              if (update_err) {
                res.status(401).send(update_error);
                return;
              }
              res.send({ access_pass: accessPass });
            });
          });
        });
    });

    io.on('connection', socket => {
      console.log(socket.id, 'has connected.')

      socket.on('handshake', accessPass => {
        validate(accessPass)
          .then(response => {
            const {
              user_id,
              session_id
            } = response;

            const _query = { _id: new ObjectID(session_id) };

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

      setInterval(() => {
        trendSessions.find({}, (err, trendSessions, r) => {
          trendSessions.forEach(trendSession => {
            const _query = {_id: new ObjectID(trendSession._id)}
            const socketRoom = io.sockets.adapter.rooms[room._id];

            if (socketRoom) {
              const clients = Object.keys(socketRoom.sockets);
              const users = Object.keys(trendSession.persistedUsers);

              users.forEach(userKey => {
                if (!clients.includes(userKey)) {
                  delete room.users[userKey];
                }
              });
              trendSessions.update(_query, trendSession);
              io.to(trendSession._id).emit('update', {
                users: room.users
              });
            }
          })
        })
      }, 20000);

      socket.on('exit', session_id => {
        // Leave current room, and no longer maintain users hash
        socket.leave(session_id);

        const _query = {_id: new ObjectID(session_id)}
        trendSessions.findOne(query, (err, trendSession, r) => {
          if (err || !room) {
          } else {
            delete room.users[socket.id];
            trendSessions.update(_query, room);
            setTimeout(
              () => io.to(sessionId).emit('update', {users: room.users}),
              500
            );
          }
        });
      });

    });
    return router;
  };
})();
