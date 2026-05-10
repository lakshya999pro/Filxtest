// server.js

const express = require("express");
const axios = require("axios");

const app = express();

app.get("/proxy", async (req, res) => {

    try {

        const videoUrl = req.query.url;

        const response = await axios({
            method: "GET",
            url: videoUrl,
            responseType: "stream"
        });

        res.setHeader(
            "Content-Type",
            response.headers["content-type"]
        );

        res.setHeader(
            "Access-Control-Allow-Origin",
            "*"
        );

        response.data.pipe(res);

    } catch (err) {

        res.status(500).send("Error");

    }

});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});
