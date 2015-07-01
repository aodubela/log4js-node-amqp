"use strict";
var log4js = require('log4js');
var amqp = require('amqp');

function amqpAppender(options) {
    var _options = setObjectDefaults(options, {
        connection: {
            url: "amqp://guest:guest@localhost:5672",
            clientProperties: {
                product: 'log4js'
            }
        },
        exchange: {
            name: 'logExchange',
            type: 'fanout',
            durable: true,
            autoDelete: false
        },
        // queue: {
            // name: 'logQ',
            // durable: true,
            // autoDelete: false
        // },
        publish: {
            mandatory: true,
            deliveryMode: 2, // persistent
            routingKey: 'msg'
        },
        sendInterval: 0,
        layout: log4js.layouts.messagePassThroughLayout,
        additionalInfo: {},
        logEventInterceptor: function (logEvent, additionalInfo) {
            return setObjectDefaults({
                timestamp: logEvent.startTime,
                data: logEvent.data,
                level: logEvent.level,
                category: logEvent.logger.category
            }, additionalInfo);
        }
    });

    _options.sendInterval *= 1000;

    var sendTimer;

    var _exchange;
    var logEventBuffer = [];

    process.on('exit', function () {
        if (connection) {
            connection.end();
        }
    });

    var onReady = function () {
        // create exchange and queue (if they don't exist) and bind the queue to the exchange
        connection.removeListener('ready', onReady);
        connection.exchange(_options.exchange.name, _options.exchange, function (exchange) {
            _exchange = exchange;
                publish(); // in case messages are waiting to be written
        });
    };

    var connection = amqp.createConnection(_options.connection);
    connection.on('ready', onReady);

    function publish() {
        if (!_exchange) {
            return;
        }

        var toLog;
        while (logEventBuffer.length > 0) {
            toLog = logEventBuffer.shift();
            _exchange.publish(
                _options.publish.routingKey,
                _options.logEventInterceptor(toLog, options.additionalInfo),
                _options.publish
            );
        }
    }

    function schedulePublish() {
        if (sendTimer) {
            return;
        }

        sendTimer = setTimeout(function () {
            clearTimeout(sendTimer);
            sendTimer = null;
            publish();
        }, _options.sendInterval);
    }

    function setObjectDefaults(obj, defaults) {
        obj = obj || {};

        Object.keys(defaults).forEach(function (key) {
            if (!obj.hasOwnProperty(key)) {
                obj[key] = defaults[key];
                return;
            }
            if (Object.prototype.toString.call(obj[key]) === '[object Object]') {
                return setObjectDefaults(obj[key], defaults[key]);
            } else {
                obj[key] = obj[key];
            }
        });
        return obj;
    }

    return function log4jsNodeAmqp(loggingEvent) {
        if (Object.prototype.toString.call(loggingEvent.data[0]) === '[object String]') {
            loggingEvent.data = _options.layout(loggingEvent);
        } else if (loggingEvent.data.length === 1) {
            loggingEvent.data = loggingEvent.data.shift();
        }
        loggingEvent.severity = loggingEvent.level.levelStr;
        loggingEvent.level = loggingEvent.level.levelStr;

        logEventBuffer.push(loggingEvent);

        if (_options.sendInterval > 0) {
            return schedulePublish();
        }

        publish();
    };
}

function configure(config) {
    if (config.layout) {
        config.layout = log4js.layouts.layout(config.layout.type, config.layout);
    }

    return amqpAppender(config);
}

exports.name = "amqp";
exports.appender = amqpAppender;
exports.configure = configure;
