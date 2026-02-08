/**
 * DataZapp Reverse Phone Append API
 * https://knowledgebase.datazapp.com/2024/06/25/reverse-phone-append-api/
 * Pass raw (unhashed) phone number; get email/address where available.
 */
module.exports = {
  API_URL: process.env.DATAZAPP_API_URL || "https://secureapi.datazapp.com/Appendv2",
  API_KEY: "PDYLEQPGVK",
  APPEND_MODULE: "ReversePhoneAppendAPI",
};
