const express = require("express");
var session = require("express-session");
const app = express();
const fs = require("fs");
const { Parser } = require("json2csv");
var path = require("path");
var sqlite3 = require("sqlite3").verbose();
var mqtt = require("mqtt");
var CronJob = require("cron").CronJob;

var client = mqtt.connect("mqtt://localhost");

var db = new sqlite3.Database("db.sqlite3");

cron_trace = {};
cron_iperf = {};
client_list = [];
saveDirectory = "./results/";

// ejs
app.set("view engine", "ejs");
app.use(
  session({
    secret: "secret",
    resave: true,
    saveUninitialized: true,
  })
);
app.engine("html", require("ejs").renderFile);
app.use(express.static(__dirname + "/static"));
app.use(function (req, res, next) {
  res.locals.session = req.session;
  next();
});
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// topics
statusTopic = "status";

// MQTT
client.on("connect", function () {
  client.subscribe(statusTopic + "/#", function (err) {
    if (!err) {
      client.publish(statusTopic, "status");
    }
  });
  client.subscribe("ping/#");
  client.subscribe("iperf/#");
});

client.on("message", function (topic, message) {
  parsedTopic = topic.split("/");
  // console.log(message.toString());

  if (parsedTopic[0] == statusTopic) {
    console.log("node " + parsedTopic[1] + " is " + message);
    if (message == "on") {
      client_list.push(parsedTopic[1]);
      db.get(`select * from nodes where node_id=${parsedTopic[1]}`, (err, row) => {
        scheduler(row["node_id"], row["traceIntervals"], () => {
          client.publish(`${row["node_id"]}/traceReset`, "");
        });
        scheduler(row["node_id"], row["iperfIntervals"], () => {
          client.publish(`${row["node_id"]}/startTest`, "");
        });
      });
    } else if (message == "off") {
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
          dest: pinger.ip,
          date: pinger.date,
          rtt: pinger.time,
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
          dest: pinger.ip,
          date: pinger.date,
          rtt: pinger.time,
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
    fs.mkdir(saveDirectory + parsedTopic[1] + "/iperf", { recursive: true }, (err) => {
      if (!err) {
        fs.writeFile(saveDirectory + parsedTopic[1] + "/iperf/" + parsedTopic[2] + ".txt", message, (err) => {
          if (err) {
            console.log(err);
          }
        });
      }
    });
  }

  // console.log(client_list);
});

// WEB Service
app.get("/", (request, response) => {
  db.all("select * from nodes", (err, rows) => {
    response.render(path.join(__dirname + "/template/index"), { nodes: rows });
  });
});

app.post("/change-settings", (request, response) => {
  nodeID = request.body["node-id"];
  sql = `select * from nodes where node_id=${nodeID}`;
  db.get(sql, (err, row) => {
    if (!err) {
      sql = `update nodes set
      traceIntervals='${request.body["node-trace"]}' , iperfIntervals='${request.body["node-iperf"]}', iperfOptions='${request.body["node-iperfOptions"]}'
      where node_id=${nodeID};`;
      db.run(sql, (err) => {
        if (!err) {
          response.redirect("/");
          scheduler(nodeID, request.body["node-trace"], () => {
            client.publish(`${nodeID}/traceReset`, "");
          });
          scheduler(nodeID, request.body["node-iperf"], () => {
            client.publish(`${nodeID}/startTest`, "");
          });
        }
      });
    } else {
      console.log(err);
    }
  });
});

function scheduler(nodeID, schedule, callback) {
  if (client_list.includes(nodeID.toString())) {
    if (cron_trace[nodeID] !== undefined) {
      cron_trace[nodeID].stop();
    }
    cron_trace[nodeID] = new CronJob(schedule, () => {
      callback();
    });
    cron_trace[nodeID].start();
  }
}

app.listen(3000, () => console.log("App listening on port 3000!"));
