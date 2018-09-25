// Configure LevelDB to access stars data
const level = require('level')
const chainDB = './starchaindata'
const db = level(chainDB)
const defaultWindow = 300 // five minutes

// lib to validate
const bitcoinMessage = require('bitcoinjs-message')

// Return current time
function getCurrentTimeStamp () {
  return new Date().getTime()
}

// CRITERION: Message format = [walletAddress]:[timeStamp]:starRegistry
function generateMessage (address) {
  return `${address}:${getCurrentTimeStamp()}:starRegistry`
}

// Check if request time stamp of value has expired
function isExpired (requestTimeStamp) {
  // time left < five minutes
  return requestTimeStamp < (Date.now() - (5 * 60 * 1000))
}

// Util file to manage validation/signature
const validateUtil = {

  // Check if signature is a signature valid
  async isValidSignature (address) {
    return db.get(address)
      .then((value) => {
        value = JSON.parse(value)
        return value.messageSignature === 'valid'
      })
      .catch(() => {throw new Error('Not authorized')})
  },

  // Remove signature from leveldb
  invalidateSignature (address) {
    db.del(address)
  },

  // CRITERION: User obtains a response in JSON format with a message to sign.
  saveRequestStarValidation: (address) => {
    const message = generateMessage(address)

    // CRITERION: Response should contain message details, request timestamp, and time remaining for validation window.
    const data = {
      address: address,
      message: message,
      requestTimeStamp: getCurrentTimeStamp(),
      validationWindow: defaultWindow
    }

    db.put(data.address, JSON.stringify(data))

    return data
  },

  // Save/return request star validation
  async getPendingAddress (address) {
    return new Promise((resolve, reject) => {
      db.get(address, (error, value) => {
        if (value === undefined) {
          return reject(new Error('Not found'))
        } else if (error) {
          return reject(error)
        }

        value = JSON.parse(value)

        // CRITERION: When re-submitting within validation window, validation window should reduce until it expires.
        if (isExpired(value.requestTimeStamp)) {
          resolve(this.saveRequestStarValidation(address))
        } else {
          // CRITERION: Response should contain message details, request timestamp, and time remaining for validation window.
          const data = {
            address: address,
            message: value.message,
            requestTimeStamp: value.requestTimeStamp,
            // CRITERION: The request must be configured with a limited validation window of five minutes.
            validationWindow: Math.floor((value.requestTimeStamp - (Date.now() - (5 * 60 * 1000))) / 1000)
          }

          resolve(data)
        }
      })
    })
  },

  // CRITERION: Web API post endpoint validates message signature with JSON response.
  async validateMessageSignature (address, signature) {
    return new Promise((resolve, reject) => {
      db.get(address, (error, value) => {
        if (value === undefined) {
          return reject(new Error('Not found'))
        } else if (error) {
          return reject(error)
        }

        value = JSON.parse(value)

        if (value.messageSignature === 'valid') {
          return resolve({
            registerStar: true,
            status: value
          })
        } else {
          let isValid = false

          // Check if request timeStamp is < that five minutes
          if (isExpired(value.requestTimeStamp)) {
            // Set validation window to zero
            value.validationWindow = 0
            // Inform expired validation message
            value.messageSignature = 'Validation expired!'
          } else {
            // CRITERION: The request must be configured with a limited validation window of five minutes.
            value.validationWindow = Math.floor((value.requestTimeStamp - (Date.now() - (5 * 60 * 1000))) / 1000)

            try {
              // CRITERION: The application will validate their request and grant access to register a star.
              isValid = bitcoinMessage.verify(value.message, address, signature)
            } catch (error) {
              isValid = false
            }

            value.messageSignature = isValid ? 'valid' : 'invalid'
          }

          db.put(address, JSON.stringify(value))

          return resolve({
            registerStar: !isExpired && isValid,
            status: value
          })
        }
      })
    })
  }

}

module.exports = validateUtil