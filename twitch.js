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
    this.isVOD = options.lastVOD

    this.subOnlyVOD = false
    this.noVODs = false
    this.VODDate = null

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
              videos(first: 2, type: ARCHIVE) {
                edges {
                  node {
                    id
                    status
                    publishedAt
                  }
                }
              }
            }
          }
        `
      })

      this.logger.debug(`Getting VOD ID`)

      const vodID = (await (await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': `${Twitch.#clientID}`,
          'Content-Length': postData.length
        },
        body: postData
      })).json())

      const VOD = vodID.data.user.videos.edges.find(vod => vod.node.status === 'RECORDED')?.node

      if (VOD) {
        this.logger.debug(`Found VOD ID: true (${VOD.id})`)
        this.VODDate = VOD.publishedAt
        return VOD.id
      }
      this.logger.debug(`Found VOD ID: false`)
      this.VODDate = null

      return null
    } catch (error) {
      this.logger.error(error)
      this.logger.debug(`Found VOD ID: false`)
      this.VODDate = null

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
      const VODID = await this.#getVODID()
      const postData = JSON.stringify({
        query: `
          query {
            videoPlaybackAccessToken(id: "${VODID}", params: {
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
        sig: accessToken.data.videoPlaybackAccessToken.signature,
        id: VODID
      }
    } catch (error) {
      return {
        token: null,
        sig: null,
        id: null
      }
    }
  }

  async #getMasterPlaylist (checkLive = false) {
    try {
      const authToken = await ((this.isVOD && !checkLive) ? this.#getVODToken() : this.#getStreamToken())

      if (!checkLive) this.logger.debug(`AuthToken: ${JSON.stringify(authToken, null, 2)}`)

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

      if (this.isVOD && !checkLive) {
        const subOnly = JSON.parse(authToken.token)?.chansub.restricted_bitrates.length > 0
         if (!authToken.id) {
          this.noVODs = true
          return ''
        } else if (subOnly) {
          this.subOnlyVOD = true
          return ''
        } else {
          this.noVODs = false
          this.subOnlyVOD = false
        }
      }

      const masterPlaylist = (await (await fetch(`https://usher.ttvnw.net/${(this.isVOD && !checkLive) ? `vod/${authToken.id}` : `api/channel/hls/${this.channel}`}.m3u8?${usherParams.join('&')}`, {
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

  async #loadMasterPlaylist (checkLive = false) {
      const masterPlaylistParser = new m3u8Parser.Parser()
      masterPlaylistParser.push(await this.#getMasterPlaylist(checkLive))
      masterPlaylistParser.end()

      const masterPlaylist = masterPlaylistParser.manifest.playlists ?? []

      if (this.isVOD && !checkLive) this.logger.debug(`Can download VOD: ${masterPlaylist.length > 0}`)

      return masterPlaylist
  }

  async #getPlaylist (quality) {
    const qualityMappings = {
      source: 'chunked',
      best: '',
      audio: 'audio_only'
    }
    const playlists = await this.#loadMasterPlaylist()
    const selectedPlaylist = playlists.find(o => o.attributes.VIDEO.includes(qualityMappings[quality] ?? quality))

    if (!selectedPlaylist) {
      if (this.isVOD) {
        const errorMessage = (this.noVODs ? 'No VOD found' : (this.subOnlyVOD ? 'Subscription required' : `No VOD of '${quality}' quality found`))
        this.logger.error(new Error(errorMessage))
        this.emit('error', errorMessage)
      } else {
        const errorMessage = `No stream of '${quality}' quality found`
        this.logger.error(new Error(errorMessage))
        this.emit('error', errorMessage)
      }
    } else {
      this.logger.debug(`Selected ${this.isVOD ? 'VOD' : 'stream'} quality: ${Object.keys(qualityMappings).find(key => qualityMappings[key] === selectedPlaylist.attributes.VIDEO) ?? selectedPlaylist.attributes.VIDEO}`)
    }

    return selectedPlaylist?.uri
  }

  async isLive () {
    return (await this.#loadMasterPlaylist(true)).length > 0
  }

  async getVOD (quality = 'best') {
    return {
      url: await this.#getPlaylist(quality),
      date: this.VODDate
    }
  }

  async getStream (quality = 'best') {
    return {
      url: await this.#getPlaylist(quality),
      date: this.VODDate
    }
  }

}

module.exports = Twitch
