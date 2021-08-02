const EventEmitter = require('events')
const { createReadStream, createWriteStream, mkdirSync, access, rename, F_OK } = require('fs')
const { basename, dirname, resolve, join } = require('path')
const { URL } = require('url')
const { get } = require('https')
const HLS = require('hls-reader')

class Downloader extends EventEmitter {

  static #fileExtension = 'ts'

  constructor (options = {}) {
    super()

    if (options.fileTemplate === undefined) throw new Error('options.fileTemplate must be set')

    this.fileTemplate = options.fileTemplate
    this.channel = options.channel ?? ''
    this.timezone = options.timezone
    this.timezoneFormat = options.timezoneFormat
    this.downloadOptions = options.downloadOptions
    this.logger = options.logger ? options.logger : console

    this.hls = null
    this.downloadQueue = null
    this.concatQueue = null
  }

  async #reserveFile (options) {
    const basefile = options.basefile
    const checkfile = options.checkfile !== undefined? options.checkfile : options.basefile

    let parts = options.parts !== undefined ? options.parts : 0

    return new Promise((p_resolve, p_reject) => {
      if (parts === 0) {
        access(resolve(`${join(dirname(basefile), basename(basefile, `.${Downloader.#fileExtension}`))} (part 1).${Downloader.#fileExtension}`), F_OK, err => {
          if (!err) { // file exist
            return p_resolve({
              basefile: basefile,
              checkfile: `${join(dirname(basefile), basename(basefile, `.${Downloader.#fileExtension}`))} (part ${++parts}).${Downloader.#fileExtension}`,
              parts: parts
            })
          } else { // file not exist
            access(resolve(checkfile), F_OK, err => {
              if (!err) { // file exist, rename
                let newfile = `${join(dirname(basefile), basename(basefile, `.${Downloader.#fileExtension}`))} (part ${++parts}).${Downloader.#fileExtension}`
                rename(resolve(basefile), resolve(newfile), err => {
                  if (!err) this.logger.debug(`renamed ${basefile} -> ${newfile}`)
                })
                return p_resolve({
                  basefile: basefile,
                  checkfile: `${join(dirname(basefile), basename(basefile, `.${Downloader.#fileExtension}`))} (part ${++parts}).${Downloader.#fileExtension}`,
                  parts: parts
                })
              } else { // file not exist, this must be first part
                return p_resolve(checkfile)
              }
            })
          }
        })
      } else {
        access(resolve(checkfile), F_OK, err => {
          if (!err) { // file exist
            return p_resolve({
              basefile: basefile,
              checkfile: `${join(dirname(basefile), basename(basefile, `.${Downloader.#fileExtension}`))} (part ${++parts}).${Downloader.#fileExtension}`,
              parts: parts
            })
          } else { // file not exist
            return p_resolve(checkfile)
          }
        })
      }
    })
    .then(data => {
      if (data instanceof Object) {
        return this.#reserveFile(data)
      } else {
        return data
      }
    })
  }

  async #parseTemplate (dateOverride = null) {
    try {
      let filename = `${this.fileTemplate}.${Downloader.#fileExtension}`

      const dateNow = dateOverride ? new Date(dateOverride) : new Date()
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

      filename = filename.replace(/:channel/gi, `${name}`)
      filename = filename.replace(/:date/gi, `${date}`)
      filename = filename.replace(/:time/gi, `${time}`)
      filename = filename.replace(/:day/gi, `${day}`)
      filename = filename.replace(/:month/gi, `${month}`)
      filename = filename.replace(/:year/gi, `${year}`)
      filename = filename.replace(/:shortYear/gi, `${shortYear}`)
      filename = filename.replace(/:period/gi, `${period}`)
      filename = filename.replace(/[?%*:|"<>]/g, '-')

      if (process.platform === 'win32') {
        filename = filename.replace(/\//g, '\\') // convert unix path seperators to windows style
        filename = filename.replace(/[?%*:|"<>]/g, '-')
        filename = filename.replace(/^([A-Z-a-z])(-)\\/, '$1:\\') // windows drive letter fix
      } else {
        filename = filename.replace(/\\/g, '/') // convert windows path seperators to unix style
        filename = filename.replace(/[!?%*:;|"'<>`\0]/g, '-') // unix invaild filename chars
      }

      mkdirSync(`${dirname(resolve(filename))}`, { recursive: true })

      filename = await this.#reserveFile({ basefile: filename })

      this.logger.debug(`saving stream to file: ${filename}`)

      return filename
    } catch (error) {
      const filename = `stream.${Downloader.#fileExtension}`

      this.logger.error(error)
      this.logger.debug(`saving stream to file: ${filename}`)

      return filename
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


    // TODO: make this method actually work with passed in outputTemplate


    mkdirSync(`${resolve('recordings/segments')}`, { recursive: true })

    try {
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


      this.downloadQueue.on('completed', segment => {
        // download of segment finished
        this.logger.debug(`Segment downloaded: ${segment}`)
        this.concatQueue.add(() => this.#concat(segment, 'recordings/segments/all.ts'))
      })
      this.downloadQueue.on('error', error => {
        // download of segment error
        this.logger.error(error)
      })
      this.downloadQueue.on('idle', () => {
        // nothing to download
      })
      this.downloadQueue.on('add', () => {
        // new segment added to download queue
      })
      this.downloadQueue.on('next', () => {
        // starting download of next segment
      })
      this.downloadQueue.on('active', () => {
        // active download
      })

      this.concatQueue.on('completed', (merged) => {
        // merge of segment finished
        this.logger.debug(`Segment concatenated: ${merged.segment} -> ${merged.all}`)
      })
      this.concatQueue.on('error', error => {
        // merge of segment error
        this.logger.error(error)
      })
      this.concatQueue.on('idle', () => {
        // nothing to merge
      })
      this.concatQueue.on('add', () => {
        // new segment added to merge queue
      })
      this.concatQueue.on('next', () => {
        // starting merge of next segment
      })
      this.concatQueue.on('active', () => {
        // active merge
      })


      // Emit once we start to download segments
      // this.emit('start')
      // Emit once we have finished downloading all segments
      // this.emit('finish')

      // use to get name for final concat. .ts file (options.data to override date used in date tokens)
      // await this.#parseTemplate(options.date)

      this.hls.once('start', () => {
        // started to parse segments
        this.logger.debug('Started parsing m3u8')
      })
      this.hls.on('segment', segment => {
        // new segment
        this.logger.debug(`New segment: ${JSON.stringify(segment, null, 2)}`)
        this.downloadQueue.add(() => this.#download(segment.uri, `recordings/segments/segment_${segment.segment}.ts`))
      })
      this.hls.once('finish', info => {
        // no more new segments
        this.logger.debug(`Finished parsing m3u8: ${JSON.stringify(info, null, 2)}`)
      })

      await this.hls.start() // start reading m3u8

    } catch (error) {
      this.logger.error(error)
    }
  }
}

module.exports = Downloader
