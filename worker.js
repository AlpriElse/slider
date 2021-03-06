require('dotenv').config()
const SocketWorker = require('socketcluster/scworker')
const _ = require('lodash')

const mongo = require('mongodb').MongoClient
const expect = require('chai').expect
const bunyan = require('bunyan')
const moment = require('moment')
const log = bunyan.createLogger({
  name: 'slider',
  streams: [
    {
      type: 'rotating-file',
      path: 'logs/slider.log',
      period: '1d',
      count: 365,
      level: 'info'
    }
  ]
})

const config = require('minimist')(process.argv.slice(2))

let PrettyStream = require('bunyan-prettystream')
let prettyStream = new PrettyStream()
prettyStream.pipe(process.stdout)
if (config.debug) {
  log.addStream({
    type: 'raw',
    stream: prettyStream,
    level: "debug"
  })
} else {
  log.addStream({
    type: 'raw',
    stream: prettyStream,
    level: "warn"
  })
}

log.debug(config)

const { OAuth2Client } = require('google-auth-library')
var client = new OAuth2Client(process.env.GOOGLE, '', '');

let sliderChanges
class Slider extends SocketWorker {
  async login (info, respond, socket) {
    try {
      var login = await client.verifyIdToken({
        idToken: info.token,
        audience: process.env.GOOGLE
      })
    } catch (err) {
      log.warn(`login failed: ${ err }`)
      return respond('login failed')
    }
    try {
      let payload = login.getPayload()
      expect(payload.hd).to.equal('illinois.edu')
      socket.setAuthToken({
        email: payload.email
      })
      return respond()
    } catch (err) {
      log.warn(`login failed ${ err }`)
      return respond('Please log in with your @illinois.edu email address')
    }
  }
  run () {
    this.scServer.on('connection', (socket) => {
      socket.on('login', (token, respond) => {
        return this.login(token, respond, socket)
      })
      socket.on('slideChange', (currentSlide, respond) => {
        let authToken = socket.getAuthToken()
        if (!(authToken)) {
          log.warn(`authentication required`)
          return respond('authentication required')
        }
        currentSlide.email = authToken.email
        currentSlide.timestamp = moment().toDate()
        log.debug(currentSlide)
        sliderChanges.insert(currentSlide)
        return respond()
      })
    })
  }
}

mongo.connect(process.env.MONGO)
  .then(client => {
    sliderChanges = client.db('Spring2018').collection('sliderChanges')
    new Slider()
  })
