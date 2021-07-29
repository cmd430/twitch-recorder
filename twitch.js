const EventEmitter = require('events')
const { escape } = require('querystring')
const m3u8Parser = require('m3u8-parser')
const pubSub = require('twitch-realtime')
const fetch = require('node-fetch')

class Twitch extends EventEmitter {

  static #clientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'

  constructor (options = {}) {
    super()

    if (options.channel === undefined) throw new Error('options.channel must be set')

    this.channel = options.channel.toLowerCase()
    this.lowLatency = options.lowLatency ?? false
    this.clientAuth = options.auth ?? null
    this.logger = options.logger ? options.logger : console
    this.tryVOD = options.tryVOD
    this.isVOD = false

    this.#setupPubSub()
  }

  async #getChannelID () {
    try {
      const postData = JSON.stringify({
        query: `
          query {
            user(login: "${this.channel}") {
              id
            }
          }
        `
      })

      const channelID = (await (await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': `${Twitch.#clientID}`,
          'Content-Length': postData.length
        },
        body: postData
      })).json())

      return channelID.data.user.id
    } catch (error) {
      this.logger.error(error)

      return null
    }
  }

  async #getVODID () {
    try {
      const postData = JSON.stringify({
        query: `
          query {
            user(login: "${this.channel}") {
              videos(first: 1) {
                edges {
                  node {
                    id
                    status
                  }
                }
              }
            }
          }
        `
      })

      const vodID = (await (await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': `${Twitch.#clientID}`,
          'Content-Length': postData.length
        },
        body: postData
      })).json())

      const vod = vodID.data.user.videos.edges[0].node

      if (vod.status.toLowerCase() === 'recording') return vodID.data.user.videos.edges[0].node.id
      return null

    } catch (error) {
      this.logger.error(error)

      return null
    }
  }

  async #setupPubSub () {
    this.pubSub = new pubSub({
      defaultTopics: [
        `video-playback-by-id.${await this.#getChannelID()}`
      ],
      reconnect: true
    })
    this.pubSub.on('connect', () => {
      this.logger.debug(`Connected to Twitch PubSub`)
    })
    this.pubSub.on('reconnect', () => {
      this.logger.debug(`Reconnected to Twitch PubSub`)
    })
    this.pubSub.on('close', () => {
      this.logger.debug(`Disconnected from Twitch PubSub`)
    })
    this.pubSub.on('error', error => {
      this.logger.error(error)
    })
    this.pubSub.on('raw', data => {
      this.logger.debug(JSON.stringify(data, null, 2))
    })
    this.pubSub.on('stream-up', () => {
      this.logger.debug('stream up')
      this.emit('live')
    })
    this.pubSub.on('stream-down', () => {
      this.logger.debug('stream down')
      this.emit('offline')
    })
  }

  async #getStreamToken () {
    try {
      const postData = JSON.stringify({
        query: `
          query {
            streamPlaybackAccessToken(channelName: "${this.channel}", params: {
              platform: "web",
              playerBackend: "mediaplayer",
              playerType: "site"
            }) {
              value
              signature
            }
          }
        `
      })

      const accessToken = (await (await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': `${Twitch.#clientID}`,
          'Authorization': this.clientAuth ? `OAuth ${this.clientAuth}` : '',
          'Content-Length': postData.length
        },
        body: postData
      })).json())

      return {
        token: accessToken.data.streamPlaybackAccessToken.value,
        sig: accessToken.data.streamPlaybackAccessToken.signature
      }
    } catch (error) {
      this.logger.error(error)

      return {
        token: null,
        sig: null
      }
    }
  }

  async #getVODToken () {
    try {
      const postData = JSON.stringify({
        query: `
          query {
            videoPlaybackAccessToken(id: "${await this.#getVODID()}", params: {
              platform: "web",
              playerBackend: "mediaplayer",
              playerType: "site"
            }) {
              value
              signature
            }
          }
        `
      })

      const accessToken = (await (await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': `${Twitch.#clientID}`,
          'Authorization': this.clientAuth ? `OAuth ${this.clientAuth}` : '',
          'Content-Length': postData.length
        },
        body: postData
      })).json())

      return {
        token: accessToken.data.videoPlaybackAccessToken.value,
        sig: accessToken.data.videoPlaybackAccessToken.signature
      }
    } catch (error) {
      this.logger.error(error)

      return {
        token: null,
        sig: null
      }
    }
  }

  async #getMasterPlaylist (isVOD = false) {
    try {
      const authToken = isVOD ? await this.#getVODToken() : await this.#getStreamToken()
      const usherParams = [
        'allow_source=true',
        'allow_audio_only=true',
        `fast_bread=${this.lowLatency}`,
        'player_backend=mediaplayer',
        'playlist_include_framerate=true',
        'reassignments_supported=true',
        'supported_codecs=vp09,avc1',
        'cdm=wv',
        `sig=${authToken.sig}`,
        `token=${escape(authToken.token)}`,
        `p=${Math.floor(100000 + Math.random() * 900000)}`,
        'type=any'
      ]

      let vodID = null
      if (isVOD) {
        this.logger.debug(`trying VOD`)

        vodID = await this.#getVODID()

        if (vodID === null) {
          this.logger.debug(`found VOD ID: false`)
          return ''
        }

        this.logger.debug(`found VOD ID: true (${vodID})`)
      }

      const masterPlaylist = (await (await fetch(`https://usher.ttvnw.net/${isVOD ? `vod/${vodID}` : `api/channel/hls/${this.channel}`}.m3u8?${usherParams.join('&')}`, {
        headers: {
          'Client-ID': `${Twitch.#clientID}`
        }
      })).text())

      return masterPlaylist
    } catch (error) {
      this.logger.error(error)

      return ''
    }
  }

  async #loadMsterPlaylist (checkLive = false) {
    if (!checkLive) {
      if (this.tryVOD) {
        const masterPlaylistVOD = new m3u8Parser.Parser()
        masterPlaylistVOD.push(await this.#getMasterPlaylist(true))
        masterPlaylistVOD.end()

        const masterPlaylist = masterPlaylistVOD.manifest.playlists ?? []
        if (masterPlaylist.length > 0) {
          this.logger.debug(`is VOD: true`)
          this.isVOD = true

          return masterPlaylist
        }
      }
    }

    const masterPlaylistStream = new m3u8Parser.Parser()
    masterPlaylistStream.push(await this.#getMasterPlaylist())
    masterPlaylistStream.end()

    if (!checkLive) {
      this.logger.debug(`is VOD: false`)
      this.isVOD = false
    }

    return masterPlaylistStream.manifest.playlists ?? []
  }

  async #getPlaylist (quality = 'best') {
    const qualityMappings = {
      source: 'chunked',
      best: '',
      audio: 'audio_only'
    }
    const playlists = await this.#loadMsterPlaylist()
    const selectedPlaylist = playlists.find(o => o.attributes.VIDEO.includes(qualityMappings[quality] ?? quality))

    if (!selectedPlaylist) {
      this.logger.error(new Error(`No stream of '${quality}' quality found`))
    } else {
      this.logger.debug(`Selected stream quality: ${Object.keys(qualityMappings).find(key => qualityMappings[key] === selectedPlaylist.attributes.VIDEO) ?? selectedPlaylist.attributes.VIDEO}`)
    }

    return selectedPlaylist?.uri
  }

  async isLive () {
    return (await this.#loadMsterPlaylist(true)).length > 0
  }

  async getStream () {
    return await this.#getPlaylist(...arguments)
  }

}

module.exports = Twitch
