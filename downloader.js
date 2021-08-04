const EventEmitter = require('events')
const { createReadStream, createWriteStream, mkdirSync, unlinkSync, access, rename, F_OK } = require('fs')
const { basename, dirname, resolve, join } = require('path')
const { URL } = require('url')
const { get } = require('https')
const HLS = require('hls-reader')

class Downloader extends EventEmitter {

  static #fileExtension = '.ts'

  constructor (options = {}) {
    super()

    if (options.fileTemplate === undefined) throw new Error('options.fileTemplate must be set')

    this.fileTemplate = options.fileTemplate
    this.outputDir = options.outputDir
    this.channel = options.channel ?? ''
    this.timezone = options.timezone
    this.timezoneFormat = options.timezoneFormat
    this.keepSegments = options.keepSegments ?? false
    this.keepAds = options.keepAds ?? false
    this.logger = options.logger ? options.logger : console

    this.hls = null
    this.downloadQueue = null
    this.concatQueue = null
  }

  async #reserveFile (filepath, parts = 1) {
    return new Promise((pResolve, pReject) => {
      access(resolve(filepath), F_OK, async err => {
        if (!err) { // file exist
          return pResolve(await this.#reserveFile(resolve(`${join(dirname(filepath), basename(filepath, `${Downloader.#fileExtension}`))} (part ${++parts})${Downloader.#fileExtension}`), parts))
        }
        // file not exist
        this.logger.debug(`saving stream to file: ${filepath}`)
        return pResolve(filepath)
      })
    })
  }

  #parseTokens (inputString) {
    try {
      let parsed = inputString

      const dateNow = new Date()
      const timeZoneDate = dateNow.toLocaleString('en-GB', {
        timeZone: `${this.timezone}`,
      }).split(', ')
      const timeZoneTime = dateNow.toLocaleString(`${this.timezoneFormat}`, {
        timeZone: `${this.timezone}`,
      }).split(', ')
      const name = this.channel.replace(/[/\\?%*:|"<>]/g, '_')
      const date = timeZoneDate[0].replace(/\//g, '.')
      const time = timeZoneTime[1].split(' ')[0].replace(/\:/g, '-')
      const day = timeZoneDate[0].split('/')[0]
      const month = timeZoneDate[0].split('/')[1]
      const year = timeZoneDate[0].split('/')[2]
      const shortYear = year.toString().substring(2)
      const period = timeZoneDate[1].split(':')[0] < 12 ? 'AM' : 'PM'

      parsed = parsed.replace(/:channel/gi, `${name}`)
      parsed = parsed.replace(/:date/gi, `${date}`)
      parsed = parsed.replace(/:time/gi, `${time}`)
      parsed = parsed.replace(/:day/gi, `${day}`)
      parsed = parsed.replace(/:month/gi, `${month}`)
      parsed = parsed.replace(/:year/gi, `${year}`)
      parsed = parsed.replace(/:shortYear/gi, `${shortYear}`)
      parsed = parsed.replace(/:period/gi, `${period}`)
      parsed = parsed.replace(/[?%*:|"<>]/g, '-')

      if (process.platform === 'win32') {
        parsed = parsed.replace(/\//g, '\\') // convert unix path seperators to windows style
        parsed = parsed.replace(/[?%*:|"<>]/g, '-')
        parsed = parsed.replace(/^([A-Z-a-z])(-)\\/, '$1:\\') // windows drive letter fix
      } else {
        parsed = parsed.replace(/\\/g, '/') // convert windows path seperators to unix style
        parsed = parsed.replace(/[!?%*:;|"'<>`\0]/g, '-') // unix invaild filename chars
      }

      return parsed
    } catch (error) {
      const parsed = `.`

      this.logger.error(error)

      return parsed
    }

  }

  async #download (uri, dest) {
    const file = createWriteStream(resolve(dest))
    const req= get(new URL(uri))

    return new Promise((resolve, reject) => {
      const onFinish = () => {
        file.close()
        resolve(file.path)
      }

      req.on('error', reject)
      req.on('timeout', () => reject(new Error('Request Timed out.')))
      req.on('response', res => {
        const stream = res.pipe(file)

        stream.on('error', reject)
        stream.on('finish', onFinish)
        stream.on('close', onFinish)
      })
    })
  }

  async #concat (src, dest) {
    const inFile = createReadStream(resolve(src))
    const outFile = createWriteStream(resolve(dest), {
      flags:'a'
    })

    return new Promise((resolve, reject) => {
      const onFinish = () => {
        outFile.close()
        resolve({
          all: outFile.path,
          segment: inFile.path
        })
      }

      inFile.on('open', () => {
        inFile.pipe(outFile)
      })
      inFile.on('close', onFinish)
      inFile.on('error', reject)
    })
  }

  async start (options = {}) {
    const PQueue = (await (await import('p-queue')).default)

    try {
      const outDir = resolve(this.#parseTokens(this.outputDir))
      const outFile = await this.#reserveFile(join(outDir, `${this.#parseTokens(this.fileTemplate)}${Downloader.#fileExtension}`))
      const segmentDir = join(outDir, 'segments')
      const segmentTemplate = join(segmentDir, `${basename(outFile, Downloader.#fileExtension)}.`)

      mkdirSync(segmentDir, { recursive: true })

      const status = {
        started: false,
        parseComplete: false,
        downloadComplete: false,
        mergeComplete: false
      }

      const finished = () => {
        if (status.parseComplete && status.downloadComplete && status.mergeComplete) this.emit('finish')
      }

      this.hls = new HLS({
        playlistURL: options.url,
        quality: options.quality
      })

      this.downloadQueue = new PQueue({
        concurrency: 1
      })
      this.concatQueue = new PQueue({
        concurrency: 1
      })

      this.hls.once('start', () => {
        // started to parse segments
        this.logger.debug('Started parsing m3u8')
        status.parseComplete = false
      })
      this.hls.once('quality', quality => {
        // selected playlist quality
        this.logger.debug(`Selected quality '${quality}'`)
      })
      this.hls.on('segment', segment => {
        // new segment
        if (segment.ad) {
          this.logger.debug(`New ad segment: ${JSON.stringify(segment, null, 2)}`)
        } else if (segment.prefetch) {
          this.logger.debug(`New prefech segment: ${JSON.stringify(segment, null, 2)}`)
        } else {
          this.logger.debug(`New segment: ${JSON.stringify(segment, null, 2)}`)
        }
        if (!segment.ad || this.keepAds) this.downloadQueue.add(() => this.#download(segment.uri, `${segmentTemplate}${segment.segment}.ts`))
      })
      this.hls.once('m3u8Master', m3u8Master => {
        // parsed master playlist
        this.logger.debug(`Master Playlist: ${JSON.stringify(m3u8Master, null, 2)}`)
      })
      this.hls.once('finish', info => {
        // no more new segments
        this.logger.debug(`Finished parsing m3u8: ${JSON.stringify(info, null, 2)}`)
        status.parseComplete = true
        finished()
      })

      this.downloadQueue.on('add', () => {
        // new segment added to download queue
        status.downloadComplete = false
        if (!status.started) {
          status.started = true
          this.emit('start')
        }
      })
      this.downloadQueue.on('completed', segment => {
        // download of segment finished
        this.logger.debug(`Segment downloaded: ${segment}`)
        this.concatQueue.add(() => this.#concat(segment, `${outFile}`))
      })
      this.downloadQueue.on('error', error => {
        // download of segment error
        this.logger.error(error)
      })
      this.downloadQueue.on('idle', () => {
        // nothing to download
        status.downloadComplete = true
        finished()
      })

      this.concatQueue.on('add', () => {
        // new segment added to merge queue
        status.mergeComplete = false
      })
      this.concatQueue.on('completed', (merged) => {
        // merge of segment finished
        this.logger.debug(`Segment concatenated: ${merged.segment} -> ${merged.all}`)
        if (!this.keepSegments) {
          try {
            unlinkSync(merged.segment)
            this.logger.debug(`Segment deleted: ${merged.segment}`)
          } catch (err) {
            this.logger.debug(`Unable to delete segment: ${merged.segment}\n${err.message}`)
          }
        }
      })
      this.concatQueue.on('error', error => {
        // merge of segment error
        this.logger.error(error)
      })
      this.concatQueue.on('idle', () => {
        // nothing to merge
        status.mergeComplete = true
        finished()
      })

      await this.hls.start() // start reading m3u8

    } catch (error) {
      this.logger.error(error)
    }
  }
}

module.exports = Downloader
