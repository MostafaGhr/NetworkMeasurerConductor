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

      db.all(
        `select * from nodes, ping where nodes.node_id=${parsedTopic[1]} and nodes.node_id=ping.node_id`,
        (err, rows) => {
          rows.forEach((row) => {
            if (row["start_on_boot"]) {
              client.publish(`${parsedTopic[1]}/ping/start`, JSON.stringify(row));
            }
            // scheduler(row["node_id"], client_list, cron_trace, row["traceIntervals"], () => {
            //   client.publish(`${row["node_id"]}/traceReset`, "");
            // });
            // scheduler(row["node_id"], client_list, cron_iperf, row["iperfIntervals"], () => {
            //   client.publish(`${row["node_id"]}/startTest`, "");
            // });
          });
        }
      );
    } else if (message == "off") {
      // console.log("off message");
      client_list.splice(client_list.indexOf(parsedTopic[1]), 1);

      db.get(`select * from nodes where node_id=${parsedTopic[1]}`, (err, row) => {
        schedulerStop(row["node_id"], client_list, cron_trace);
        schedulerStop(row["node_id"], client_list, cron_iperf);
      });
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
    console.log(rows);
    response.render(path.join(__dirname + "/template/index"), { nodes: rows });
  });
});

app.get("/ping", (request, response) => {
  db.all("select * from ping", (err, pingRows) => {
    db.all("select * from nodes", (err, nodesRows) => {
      response.render(path.join(__dirname + "/template/ping"), { ping: pingRows, nodes: nodesRows });
    });
  });
});

app.post("/ping", (request, response) => {
  pingID = request.body["ping-id"];
  sql = `select * from ping where ping_id=${pingID}`;
  db.get(sql, (err, row) => {
    if (!err) {
      sql = `update ping set
      node_id='${request.body["node-id"]}' ,start_on_boot='${request.body["ping-start"]}', interval='${request.body["ping-interval"]}',
      src='${request.body["ping-src"]}' ,dest='${request.body["ping-dest"]}', load_size='${request.body["ping-load-size"]}'
      where ping_id=${pingID}`;
      db.run(sql, (err) => {
        if (!err) {
          response.redirect("/ping");
        }
      });
    }
  });
});

app.post("/ping-start", (request, response) => {
  for (var attr in request.body) {
    if (request.body[attr] == "on") {
      db.all(`select * from nodes, ping where nodes.node_id=${attr} and nodes.node_id=ping.node_id`, (err, rows) => {
        rows.forEach((row) => {
          client.publish(`${attr}/ping/start`, JSON.stringify(row));
        });
      });
    }
  }
  response.redirect("/ping");
});

app.post("/ping-stop", (request, response) => {
  for (var attr in request.body) {
    if (request.body[attr] == "on") {
      client.publish(`${attr}/ping/stop`, "");
    }
  }
  response.redirect("/ping");
});

app.get("/trace", (request, response) => {
  db.all("select * from trace", (err, traceRows) => {
    db.all("select * from nodes", (err, nodesRows) => {
      response.render(path.join(__dirname + "/template/trace"), { trace: traceRows, nodes: nodesRows });
    });
  });
});

app.post("/trace", (request, response) => {
  traceID = request.body["trace-id"];
  sql = `select * from trace where trace_id=${traceID}`;
  db.get(sql, (err, row) => {
    if (!err) {
      sql = `update trace set
      node_id='${request.body["node-id"]}' ,interval='${request.body["trace-interval"]}',
      dest='${request.body["trace-dest"]}', depth='${request.body["trace-depth"]}'
      where trace_id=${traceID}`;
      db.run(sql, (err) => {
        if (!err) {
          response.redirect("/trace");
        }
      });
    }
  });
});

app.post("/trace-start", (request, response) => {
  for (var attr in request.body) {
    if (request.body[attr] == "on") {
      db.all(`select * from nodes, trace where nodes.node_id=${attr} and nodes.node_id=trace.node_id`, (err, rows) => {
        rows.forEach((row) => {
          scheduler(attr, client_list, cron_trace, row["interval"], () => {
            client.publish(`${row["node_id"]}/traceReset`, JSON.stringify(row));
          });
        });
      });
    }
  }
  response.redirect("/trace");
});

app.post("/trace-stop", (request, response) => {
  for (var attr in request.body) {
    if (request.body[attr] == "on") {
      schedulerStop(attr, client_list, cron_trace);
    }
  }
  response.redirect("/trace");
});

app.get("/iperf", (request, response) => {
  db.all("select * from iperf", (err, iperfRows) => {
    db.all("select * from nodes", (err, nodesRows) => {
      response.render(path.join(__dirname + "/template/iperf"), { iperf: iperfRows, nodes: nodesRows });
    });
  });
});

app.post("/iperf", (request, response) => {
  iperfID = request.body["iperf-id"];
  sql = `select * from iperf where iperf_id=${iperfID}`;
  db.get(sql, (err, row) => {
    if (!err) {
      sql = `update iperf set
      node_id='${request.body["node-id"]}', interval='${request.body["iperf-interval"]}',
      option1='${request.body["iperf-opt1"]}', option2='${request.body["iperf-opt2"]}',
      server_ip='${request.body["iperf-server"]}', server_port='${request.body["iperf-port"]}'
      where iperf_id=${iperfID}`;
      db.run(sql, (err) => {
        if (!err) {
          response.redirect("/iperf");
        }
      });
    }
  });
});

app.post("/iperf-start", (request, response) => {
  for (var attr in request.body) {
    if (request.body[attr] == "on") {
      db.all(`select * from nodes, iperf where nodes.node_id=${attr} and nodes.node_id=iperf.node_id`, (err, rows) => {
        rows.forEach((row) => {
          scheduler(attr, client_list, cron_iperf, row["interval"], () => {
            client.publish(`${row["node_id"]}/startTest`, JSON.stringify(row));
          });
        });
      });
    }
  }
  response.redirect("/iperf");
});

app.post("/iperf-stop", (request, response) => {
  for (var attr in request.body) {
    if (request.body[attr] == "on") {
      schedulerStop(attr, client_list, cron_iperf);
    }
  }
  response.redirect("/iperf");
});

function scheduler(nodeID, node_list, cron_obj, scheduleTime, callback) {
  // may occur problem with multiple obj of same key
  if (node_list.includes(nodeID.toString())) {
    if (cron_obj[nodeID] !== undefined) {
      // cron_obj[nodeID].stop();
      cron_obj[nodeID].forEach((cron) => {
        cron.stop();
      });
      cron_obj[nodeID] = [];
    }
    t = new CronJob(scheduleTime, () => {
      callback();
    });
    t.start();
    cron_obj[nodeID] = [];
    cron_obj[nodeID].push(t);
  }
}

function schedulerStop(nodeID, node_list, cron_obj) {
  if (node_list.includes(nodeID.toString())) {
    if (cron_obj[nodeID] !== undefined) {
      // cron_obj[nodeID].stop();
      cron_obj[nodeID].forEach((cron) => {
        cron.stop();
      });
      cron_obj[nodeID] = [];
    }
  }
}

app.listen(3000, () => console.log("App listening on port 3000!"));
