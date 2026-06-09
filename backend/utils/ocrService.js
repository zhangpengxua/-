const axios = require('axios');
require('dotenv').config();

const BAIDU_OCR_API_KEY = process.env.BAIDU_OCR_API_KEY;
const BAIDU_OCR_SECRET_KEY = process.env.BAIDU_OCR_SECRET_KEY;

class OCRService {
  static accessToken = null;
  static tokenExpireTime = 0;

  // 获取百度OCR的access_token
  static async getAccessToken() {
    const now = Date.now();
    
    // 如果token未过期，直接返回
    if (this.accessToken && now < this.tokenExpireTime) {
      return this.accessToken;
    }

    try {
      const response = await axios.post('https://aip.baidubce.com/oauth/2.0/token', null, {
        params: {
          grant_type: 'client_credentials',
          client_id: BAIDU_OCR_API_KEY,
          client_secret: BAIDU_OCR_SECRET_KEY
        }
      });

      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        // 设置过期时间（token有效期通常为30天，这里设置为29天）
        this.tokenExpireTime = now + (response.data.expires_in || 2505600) * 1000;
        return this.accessToken;
      } else {
        throw new Error('Failed to get access token');
      }
    } catch (error) {
      console.error('Baidu OCR Access Token Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // 通用文字识别（标准版）
  static async recognizeText(imageBase64) {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await axios.post('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic', {
        image: imageBase64
      }, {
        params: {
          access_token: accessToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.data && response.data.words_result) {
        // 将识别结果拼接成文本
        return response.data.words_result.map(item => item.words).join('\n');
      }
      return '';
    } catch (error) {
      console.error('Baidu OCR Recognize Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // 通用文字识别（高精度版）
  static async recognizeTextAccurate(imageBase64) {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await axios.post('https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic', {
        image: imageBase64
      }, {
        params: {
          access_token: accessToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.data && response.data.words_result) {
        return response.data.words_result.map(item => item.words).join('\n');
      }
      return '';
    } catch (error) {
      console.error('Baidu OCR Accurate Recognize Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // 手写文字识别
  static async recognizeHandwriting(imageBase64) {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await axios.post('https://aip.baidubce.com/rest/2.0/ocr/v1/handwriting', {
        image: imageBase64
      }, {
        params: {
          access_token: accessToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.data && response.data.words_result) {
        return response.data.words_result.map(item => item.words).join('\n');
      }
      return '';
    } catch (error) {
      console.error('Baidu OCR Handwriting Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // 从URL识别文字
  static async recognizeTextFromUrl(imageUrl) {
    try {
      const accessToken = await this.getAccessToken();
      
      const response = await axios.post('https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic', {
        url: imageUrl
      }, {
        params: {
          access_token: accessToken
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      if (response.data && response.data.words_result) {
        return response.data.words_result.map(item => item.words).join('\n');
      }
      return '';
    } catch (error) {
      console.error('Baidu OCR URL Recognize Error:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = OCRService;
