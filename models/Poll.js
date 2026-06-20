const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
  },
  votes: {
    type: Number,
    default: 0,
  },
});

const voteRecordSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    ip: { type: String, required: true },
    optionId: { type: mongoose.Schema.Types.ObjectId, required: true },
  },
  { _id: false }
);

const pollSchema = new mongoose.Schema(
  {
    question: {
      type: String,
      required: true,
    },
    options: {
      type: [optionSchema],
      validate: {
        validator: (opts) => opts.length >= 2,
        message: 'A poll needs at least two options.',
      },
    },
    votedBy: {
      type: [voteRecordSchema],
      default: [],
      select: false, // never sent to the client — internal bookkeeping only
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Poll', pollSchema);