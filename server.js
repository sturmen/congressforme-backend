var https = require('https');
var express = require('express')
var app = express()
var loki = require('lokijs')

var db = new loki("database.json", {
    verbose: true,
    autosave: true,
    autosaveInterval: 100000,
    autoload: true
});

/*
Zip object format.
{
    "zip": "10009", // index
    "senators": ["1", "2", "3"], // IDs
    "congresspersons": ["1", "2", "3"] 
}
*/
var zipcodes = db.getCollection('zipcodes');
if (zipcodes === null) {
    zipcodes = db.addCollection('zipcodes', {
        "unique": ["zip"],
        "indices": ["zip"]
    });
}

/*
legislator format
{
    "_id": "1", // index
    "first_name": "Bernie",
    "last_name": "Sanders",
    "middle_name": "",
    "state": "VT",
    "party": "I",
    "chamber": "sen",
    "district": null, // only for reps
    "phone": "202-224-5141",
    "office": "332 Dirksen Senate Office Building",
    "website": "https://www.sanders.senate.gov/",
    "contact_form": "https://www.sanders.senate.gov/contact",
}
*/
var legislators = db.getCollection('legislators');
if (legislators === null) {
    legislators = db.addCollection('legislators', {
        "unique": ["_id"],
        "indices": ["_id"]
    });
}

let getLegislatorsFromSunlightByZip = function (zip, callback, errorCallback) {
    const host = 'https://congress.api.sunlightfoundation.com';
    const resource = '/legislators/locate';
    let urlPath = host + resource + '?zip=' + zip;
    let networkCallback = function (response) {
        let rawData = '';
        response.on('data', (chunk) => rawData += chunk);
        response.on('end', () => {
            try {
                callback(rawData);
            } catch (e) {
                console.log(e.message);
            }
        });
        response.on('error', (e) => {
            console.log(e);
            errorCallback(e);
        });
    }
    https.get(urlPath, networkCallback);
}

let saveInformation = function (jsonString, zipcode, callback) {
    let jsonBody = JSON.parse(jsonString);
    let results = jsonBody.results;    
    let legislatorspayload = [];
    let zipDBObj = {
        "zip": zipcode, // index
        "senators": [], // IDs
        "congresspersons": [] 
    }
    let arrayLength = results.length;
    for (var i = 0; i < arrayLength; i++) {
        let legislator = results[i];
        let strippedDown = {
            "_id": legislator.bioguide_id,
            "first_name": legislator.first_name,
            "last_name": legislator.last_name,
            "middle_name": legislator.middle_name,
            "nickname": legislator.nickname,
            "state": legislator.state,
            "party": legislator.party,
            "chamber": legislator.chamber,
            "phone": legislator.phone,
            "office": legislator.office,
            "website": legislator.website,
            "contact_form": legislator.contact_form
        }
        if (legislator.hasOwnProperty("district")) {
            strippedDown.district = legislator.district;
        }
        
        if (legislators.findOne({"_id": strippedDown["_id"]}) === null) {
            try {
                legislators.insertOne(strippedDown, true);
            } catch (e) {
                console.log(e);
            }
        }
        legislatorspayload.push(strippedDown);
        
        if (legislator.chamber === "house") {
            zipDBObj.congresspersons.push(strippedDown["_id"]);
        } else if (legislator.chamber === "senate") {
            zipDBObj.senators.push(strippedDown["_id"]);
        }
    }
    try {
        zipcodes.insertOne(zipDBObj);        
    } catch (e) {
        console.log(e);
    }
    let payload = { "zip": zipcode, "legislators": legislatorspayload};
    console.log("About to send response payload: " + JSON.stringify(payload));
    callback(payload);
}

let gatherLegislators = function (zipObject, callback) {
    var senators = legislators.find({ '_id' : { '$in' : zipObject.senators}});
    var representatives = legislators.find({ '_id' : { '$in' : zipObject.congresspersons}});
    let payload = senators.concat(representatives);
    callback({ "zip": zipObject.zip, "legislators": payload});
}

app.use(express.static('public'))

app.get('/api/v1/zip/:zipcode', function (req, res) {
    res.setHeader('Content-Type', 'application/json');    
    let zipcode = req.params.zipcode;
    let dbResult = zipcodes.findOne({"zip": zipcode});
    if (dbResult != null) {
    console.log("gathering from memory for " + zipcode)        
        gatherLegislators(dbResult, (payload) => res.send(payload));
    } else {
        console.log("going to network for " + zipcode);   
        getLegislatorsFromSunlightByZip(zipcode, (jsonBody) => {
            saveInformation(jsonBody, zipcode, (payload) => res.send(payload));
        }, (error) => {
            res.statusCode = 500;
            res.send({"error": "A server error ocurred."});
        });
    }
})

app.get('/api/v1/data', function (req, res) {
    res.setHeader('Content-Type', 'application/json');        
    let data = db.serialize();
    res.send(data);
})

app.listen(3000, function () {
  console.log('Congress For Me started on port 3000!')
})