const User = require("../models/userModel");
const jwt = require("jsonwebtoken");

// Helper function to generate JWT token
const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || "your-secret-key", {
    expiresIn: "24h",
  });
};

// Helper function to verify JWT token
const verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
  } catch (error) {
    return null;
  }
};

// REGISTER NEW USER
exports.register = async (req, res) => {
  try {
    const { username, email, password, firstName, lastName, role } = req.body;

    // Validate required fields
    if (!username || !email || !password) {
      return res.status(400).json({
        error: "Username, email, and password are required.",
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existingUser) {
      return res.status(400).json({
        error: "User with this email or username already exists.",
      });
    }

    // Create new user
    const user = new User({
      username,
      email,
      password,
      firstName,
      lastName,
      role: role || "user", // Use provided role or default to "user"
    });

    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      message: "User registered successfully.",
      user: user.toJSON(),
      token,
    });
  } catch (err) {
    console.error("Registration error:", err);

    // Handle validation errors
    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        error: "Validation failed.",
        details: errors,
      });
    }

    res.status(500).json({ error: "Server error during registration." });
  }
};

// USER LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        error: "Email and password are required.",
      });
    }

    // Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        error: "Account is deactivated. Please contact support.",
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        error: "Invalid email or password.",
      });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken(user._id);

    res.status(200).json({
      message: "Login successful.",
      user: user.toJSON(),
      token,
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Server error during login." });
  }
};

// GET USER PROFILE
exports.getProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Access token required.",
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        error: "Invalid or expired token.",
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    res.status(200).json({
      user: user.toJSON(),
    });
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "Server error while fetching profile." });
  }
};

// UPDATE USER PROFILE
exports.updateProfile = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Access token required.",
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        error: "Invalid or expired token.",
      });
    }

    const { firstName, lastName, email } = req.body;
    const updateData = {};

    if (firstName !== undefined) updateData.firstName = firstName;
    if (lastName !== undefined) updateData.lastName = lastName;
    if (email !== undefined) updateData.email = email;

    // Check if email is being updated and if it's already taken
    if (email) {
      const existingUser = await User.findOne({
        email,
        _id: { $ne: decoded.userId },
      });

      if (existingUser) {
        return res.status(400).json({
          error: "Email is already in use by another account.",
        });
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      decoded.userId,
      updateData,
      { new: true, runValidators: true }
    );

    if (!updatedUser) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    res.status(200).json({
      message: "Profile updated successfully.",
      user: updatedUser.toJSON(),
    });
  } catch (err) {
    console.error("Update profile error:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        error: "Validation failed.",
        details: errors,
      });
    }

    res.status(500).json({ error: "Server error while updating profile." });
  }
};

// CHANGE PASSWORD
exports.changePassword = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Access token required.",
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        error: "Invalid or expired token.",
      });
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Current password and new password are required.",
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        error: "Current password is incorrect.",
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.status(200).json({
      message: "Password changed successfully.",
    });
  } catch (err) {
    console.error("Change password error:", err);

    if (err.name === "ValidationError") {
      const errors = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({
        error: "Validation failed.",
        details: errors,
      });
    }

    res.status(500).json({ error: "Server error while changing password." });
  }
};

// DELETE ACCOUNT
exports.deleteAccount = async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Access token required.",
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        error: "Invalid or expired token.",
      });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        error: "Password is required to delete account.",
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({
        error: "User not found.",
      });
    }

    // Verify password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({
        error: "Password is incorrect.",
      });
    }

    // Delete user
    await User.findByIdAndDelete(decoded.userId);

    res.status(200).json({
      message: "Account deleted successfully.",
    });
  } catch (err) {
    console.error("Delete account error:", err);
    res.status(500).json({ error: "Server error while deleting account." });
  }
};

// LOGOUT (client-side token removal)
exports.logout = async (req, res) => {
  try {
    // Since JWT tokens are stateless, logout is handled client-side
    // by removing the token from storage
    res.status(200).json({
      message: "Logged out successfully.",
    });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Server error during logout." });
  }
};

// Middleware to verify JWT token
exports.verifyToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "Access token required.",
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({
        error: "Invalid or expired token.",
      });
    }

    req.userId = decoded.userId;
    next();
  } catch (err) {
    console.error("Token verification error:", err);
    res.status(401).json({ error: "Invalid token." });
  }
};
