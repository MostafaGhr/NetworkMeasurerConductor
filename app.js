const express = require('express');
var session = require('express-session');
const app = express();
const fs = require('fs');
const { Parser } = require('json2csv');
var path = require('path');

var mqtt = require('mqtt')

var client = mqtt.connect('mqtt://localhost')

client_list = []
saveDirectory = "./results/"
//ejs

app.set('view engine', 'ejs');
app.use(session({
	secret: 'secret',
	resave: true,
	saveUninitialized: true
}));
app.engine('html', require('ejs').renderFile);
app.use(express.static(__dirname + '/static'));
// app.set('views', './template')
app.use(function(req, res, next) {
	res.locals.session = req.session;
	next();
});
// app.use(bodyParser.urlencoded({extended : true}));
// app.use(bodyParser.json());
// end ejs

// topics
statusTopic = "status"

client.on('connect', function () {
  client.subscribe(statusTopic + '/#', function (err) {
    if (!err) {
      client.publish(statusTopic, 'status');
    }
  });
  client.subscribe("ping/#")
})

client.on('message', function (topic, message) {
  parsedTopic = topic.split("/");
  // console.log(message.toString());


  if (parsedTopic[0] == statusTopic) {
    if (message == "on") {
      client_list.push(parsedTopic[1]);
    }
    else if (message == "off") {
      // console.log("off message");
      client_list.splice(client_list.indexOf(parsedTopic[1]), 1);
    }
  }

  if (parsedTopic[0] == "ping") {
    pinger = JSON.parse(message);
    savePath = saveDirectory + parsedTopic[1] + "/" + pinger.ip + ".csv";
    fs.access(savePath, fs.constants.F_OK | fs.constants.W_OK, (err) => {
      if (err) {
          const json2csvParser = new Parser({ header: true });
          csver = json2csvParser.parse({
              "dest":pinger.ip,
              "date":pinger.date,
              "rtt":pinger.time
          });
          fs.mkdir(saveDirectory + parsedTopic[1], { recursive: true }, (err) => {
            if (!err) {
              fs.writeFile(savePath, csver + "\n\r", (err) => {
                if (err) {
                  console.log(err);
                }
              });
            }
          });
      } else {
          const json2csvParser = new Parser({ header: false });
          csver = json2csvParser.parse({
            "dest":pinger.ip,
            "date":pinger.date,
            "rtt":pinger.time
          });
          fs.appendFile(savePath, csver + "\r\n", (err) => {
              if (err) {
                  console.log(err);
              }
          });
      }
  });
  }

  if (parsedTopic[0] == "iperf") {
    fs.mkdir(saveDirectory + parsedTopic[1], { recursive: true }, (err) => {
      if (!err) {
        fs.writeFile("./" + parsedTopic[1] + "/" + parsedTopic[2] + ".json", message);
      }
    });
  }

  // console.log(client_list);
});


app.get("/", (request, result) => {
  result.render(path.join(__dirname + '/template/index'),);
});


app.listen(3000, () => console.log('App listening on port 3000!'));
