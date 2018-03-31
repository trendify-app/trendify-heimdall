#!/usr/bin/env node

;(() => {
  'use strict';

  const express      = require('express');
  const bodyParser   = require('body-parser');
  const cookieParser = require('cookie-parser');
  const path         = require('path');
  const logger       = require('morgan');
  const process      = require('process');
  const http         = require('http');
  const https        = require('https');
  const port         = process.env.PORT || 8080;
  const MongoClient  = require('mongodb').MongoClient;
  const assert       = require('assert')
  const fs           = require('fs')
  const cors         = require('cors')
  const app = express();

  const config = {
    key: fs.readFileSync('.cert/key.pem'),
    cert: fs.readFileSync('.cert/cert.pem')
  }

  const httpServer = http.createServer(app);
  // const httpsServer = https.createServer(config, app);

  const io = require('socket.io')(httpServer);

  io.set('transports', ['websocket', 'polling']);

  MongoClient.connect('mongodb://localhost:27017/trendify', (err, db) => {
    assert.equal(err, null)

    const api = require('./routes/api')(db, io);

    app.all(/^((?!(api|assets|fonts|torii|crossdomain\.xlm|robots\.txt|logo|index)).)*$/, function (req, res, next) {
      res.sendFile('./public/index.html', {root: __dirname});
    });

    app.use(logger('dev'))
      .use(bodyParser.json())
      .use(cors({ origin: 'http://localhost:4200' }))
      .use(cookieParser())
      .use(bodyParser.urlencoded({ extended: false }))
      .use('/api/', api)
      .use(express.static('public'))
      .set('port', port)
  });

  httpServer.listen(port);
  // httpsServer.listen(443);

  console.log(`[app] Serving on port 8080`);
})();
