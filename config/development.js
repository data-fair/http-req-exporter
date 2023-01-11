module.exports = {
  interval: 10,
  reqs: {
    test: {
      url: 'http://localhost:9090/mocks/1',
      contains: ['ok']
    }
  }
}
