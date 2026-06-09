const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  role: {
    type: String,
    required: true,
    enum: ['user', 'assistant']
  },
  content: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  imageUrl: {
    type: String,
    default: null
  },
  ocrText: {
    type: String,
    default: null
  }
});

const ConversationSchema = new mongoose.Schema({
  title: {
    type: String,
    default: '未命名对话'
  },
  messages: [MessageSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Conversation', ConversationSchema);
