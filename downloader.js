const EventEmitter = require('events')
const { createWriteStream, mkdirSync, access, rename, F_OK } = require('fs')
const { basename, dirname, resolve, join } = require('path')
const m3u8Stream = require('m3u8stream')

class Downloader extends EventEmitter {

  constructor (options = {}) {
    super()

    if (options.fileTemplate === undefined) throw new Error('options.fileTemplate must be set')

    this.fileTemplate = options.fileTemplate
    this.channel = options.channel ?? ''
    this.timezone = options.timezone
    this.timezoneFormat = options.timezoneFormat
    this.downloadOptions = options.downloadOptions
    this.logger = options.logger ? options.logger : console
  }

  async #reserveFile (options) {
    const basefile = options.basefile
    const checkfile = options.checkfile !== undefined? options.checkfile : options.basefile

    let parts = options.parts !== undefined ? options.parts : 0

    return new Promise((p_resolve, p_reject) => {
      if (parts === 0) {
        access(resolve(`${join(dirname(basefile), basename(basefile, `.mp4`))} (part 1).mp4`), F_OK, err => {
          if (!err) { // file exist
            return p_resolve({
              basefile: basefile,
              checkfile: `${join(dirname(basefile), basename(basefile, `.mp4`))} (part ${++parts}).mp4`,
              parts: parts
            })
          } else { // file not exist
            access(resolve(checkfile), F_OK, err => {
              if (!err) { // file exist, rename
                let newfile = `${join(dirname(basefile), basename(basefile, `.mp4`))} (part ${++parts}).mp4`
                rename(resolve(basefile), resolve(newfile), err => {
                  if (!err) this.logger.debug(`renamed ${basefile} -> ${newfile}`)
                })
                return p_resolve({
                  basefile: basefile,
                  checkfile: `${join(dirname(basefile), basename(basefile, `.mp4`))} (part ${++parts}).mp4`,
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
              checkfile: `${join(dirname(basefile), basename(basefile, `.mp4`))} (part ${++parts}).mp4`,
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

  async #parseTemplate () {
    try {
      let filename = `${this.fileTemplate}.mp4`

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
      const filename = 'stream.mp4'

      this.logger.error(error)
      this.logger.debug(`saving stream to file: ${filename}`)

      return filename
    }
  }

  async start (URL) {
    try {
      if (!URL) return
      return m3u8Stream(URL, {
        requestOptions: this.downloadOptions
      })
      .once('response', () => this.emit('start'))
      .on('end', () => this.emit('finish'))
      .on('error', error => this.emit('error', error))
      .pipe(createWriteStream(await this.#parseTemplate()))
    } catch (error) {
      this.logger.error(error)
    }
  }
}

module.exports = Downloader
