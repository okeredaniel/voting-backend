const express = require('express');
const cors = require('cors');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const Poll = require('./models/Poll');

require('dotenv/config');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(cors());
app.use(express.json());

// Needed so req.ip reflects the real client IP rather than a proxy's IP,
// if this server ever runs behind a reverse proxy / load balancer / platform like Render or Heroku.
app.set('trust proxy', true);

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => console.error('MongoDB connection error:', err));

// Create a poll
app.post('/polls', async (req, res) => {
  try {
    const { question, options } = req.body;

    if (!question || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({
        error: 'A poll needs a question and at least two options.',
      });
    }

    const poll = await Poll.create({
      question,
      options: options.map((label) => ({ label, votes: 0 })),
    });

    res.status(201).json(poll);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong creating the poll.' });
  }
});

// Fetch a poll + current results
app.get('/polls/:id', async (req, res) => {
  try {
    const { deviceId } = req.query;
    const ip = req.ip;

    const poll = await Poll.findById(req.params.id).select('+votedBy');
    if (!poll) return res.status(404).json({ error: 'Poll not found.' });

    const existingVote = deviceId
      ? poll.votedBy.find((record) => record.deviceId === deviceId || record.ip === ip)
      : null;

    const publicPoll = poll.toObject();
    delete publicPoll.votedBy;
    publicPoll.votedOption = existingVote ? String(existingVote.optionId) : null;

    res.json(publicPoll);
  } catch (err) {
    res.status(404).json({ error: 'Poll not found.' });
  }
});

// Cast a vote
app.post('/polls/:id/vote', async (req, res) => {
  try {
    const { optionId, deviceId } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'Missing device ID.' });
    }

    const ip = req.ip;

    // votedBy has `select: false` in the schema, so it must be explicitly requested here
    const poll = await Poll.findById(req.params.id).select('+votedBy');
    if (!poll) return res.status(404).json({ error: 'Poll not found.' });

    const option = poll.options.id(optionId);
    if (!option) {
      return res.status(404).json({ error: 'Option not found on this poll.' });
    }

    const existingVote = poll.votedBy.find(
      (record) => record.deviceId === deviceId || record.ip === ip
    );

    if (existingVote) {
      const publicPoll = poll.toObject();
      delete publicPoll.votedBy;
      publicPoll.votedOption = String(existingVote.optionId);
      return res.status(409).json({
        error: 'This device has already voted on this poll.',
        poll: publicPoll,
      });
    }

    option.votes += 1;
    poll.votedBy.push({ deviceId, ip, optionId });
    await poll.save();

    // Strip votedBy before broadcasting/responding — it should never reach the client
    const publicPoll = poll.toObject();
    delete publicPoll.votedBy;
    publicPoll.votedOption = optionId;

    // Broadcast the new tallies to everyone viewing this poll.
    // votedOption is per-device, so we omit it from the broadcast — each
    // client already knows its own vote and will merge it in locally.
    const broadcastPoll = { ...publicPoll };
    delete broadcastPoll.votedOption;
    io.to(poll.id).emit('results', broadcastPoll);

    res.json(publicPoll);
  } catch (err) {
    console.error(err);
    res.status(404).json({ error: 'Poll not found.' });
  }
});

io.on('connection', (socket) => {
  socket.on('join-poll', (pollId) => {
    socket.join(pollId);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Voting backend running on http://localhost:${PORT}`);
});