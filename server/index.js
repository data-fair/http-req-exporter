const config = require('config')
const express = require('express')
const client = require('prom-client')
const http = require('http')
const https = require('https')
const CacheableLookup = require('cacheable-lookup')
const eventToPromise = require('event-to-promise')
const debug = require('debug')('exporter')
const asyncWrap = require('./utils/async-wrap')

// prepare a axios instance that never fails and simply resolves with the http code
const cacheableLookup = new CacheableLookup()
const httpAgent = new http.Agent({})
const httpsAgent = new https.Agent({})
cacheableLookup.install(httpAgent)
cacheableLookup.install(httpsAgent)
const axios = require('axios').create({ httpAgent, httpsAgent })
axios.interceptors.request.use(config => {
  config.headers.common.referer = 'http-req-exporter'
  return config
})
axios.interceptors.response.use(response => response, error => {
  console.warn('HTTP request error', error)
  if (!error.response) {
    console.warn('axios error', error)
    return 0
  }
  delete error.response.request
  delete error.response.headers
  error.response.config = { method: error.response.config.method, url: error.response.config.url, data: error.response.config.data }
  if (error.response.config.data && error.response.config.data._writableState) delete error.response.config.data
  if (error.response.data && error.response.data._readableState) delete error.response.data
  let messageText = error.response.statusText
  if (error.response.data) {
    messageText = typeof error.response.data === 'string' ? error.response.data : JSON.stringify(error.response.data)
  }
  error.response.message = `${error.response.status} - ${messageText}`
  console.warn('HTTP error', error.response)
  return { status: error.response.status }
})

// prepare the prometheus client register
const register = new client.Registry()
const httpReqsHistogram = new client.Histogram({
  name: 'df_http_reqs_seconds',
  help: 'Duration in seconds of HTTP requests',
  labelNames: ['name', 'status'],
  registers: [register]
})

const reqs = JSON.parse(JSON.stringify(config.reqs).replace(/\$timestamp/g, new Date().getTime()))

const app = express()
const server = require('http').createServer(app)

let running = false
const iteration = async () => {
  debug('starting iteration')
  if (running) return // prevent overlapping
  running = true
  for (const name in reqs) {
    const req = typeof reqs[name] === 'string' ? { url: reqs[name] } : reqs[name]
    const end = httpReqsHistogram.startTimer()
    let { status, data } = await axios(req.url)
    for (const contain of req.contains || []) {
      if (!data.includes(contain)) {
        console.warn('missing expected content', req.url, contain)
        status = 417
      }
    }
    const seconds = end({ name, status })
    debug('req', name, reqs[name], status, seconds)
  }
  running = false
}

app.get('/metrics', asyncWrap(async (req, res) => {
  res.set('Content-Type', register.contentType)
  res.send(await register.metrics())
}))

let interval, currentIteration;
(async function main () {
  server.listen(config.port)
  await eventToPromise(server, 'listening')
  console.log('Prometheus metrics server listening on http://localhost:' + config.port)

  console.log('starting loop')
  currentIteration = iteration()
  interval = setInterval(iteration, config.interval * 1000)
})()

process.on('SIGTERM', async function onSigterm () {
  console.info('Received SIGTERM signal, shutdown gracefully...')
  if (interval) clearInterval(interval)
  if (currentIteration) await currentIteration
  server.close()
  await eventToPromise(server, 'close')
  console.log('shutting down now')
  process.exit()
})

// dev only mocks
if (process.env.NODE_ENV === 'development') {
  app.get('/mocks/1', (req, res) => {
    setTimeout(() => { res.send('ok') }, 50)
  })
}
