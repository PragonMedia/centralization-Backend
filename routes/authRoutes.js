const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// Public routes (no authentication required)
router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/logout", authController.logout);

// Protected routes (authentication required)
router.get("/profile", authController.verifyToken, authController.getProfile);
router.put(
  "/profile",
  authController.verifyToken,
  authController.updateProfile
);
router.put(
  "/change-password",
  authController.verifyToken,
  authController.changePassword
);
router.delete(
  "/account",
  authController.verifyToken,
  authController.deleteAccount
);

module.exports = router;
