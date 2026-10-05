exports.register = async (req, res, next) => {
//   try {
//     const { email, phoneNumber, password } = req.body;

//     if (!email || !password) {
//       return res.status(400).json({ message: 'Email and password are required' });
//     }

//     // Hash Password
//     const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

//     const query = `
//       INSERT INTO users (email, phone_number, password_hash)
//       VALUES ($1, $2, $3)
//       RETURNING id, email, phone_number, created_at;
//     `;
//     const result = await pool.query(query, [email, phoneNumber || null, passwordHash]);

//     return res.status(201).json({
//       message: 'User registered successfully',
//       user: result.rows[0],
//     });
//   } catch (error) {
//     if (error.code === '23505') {
//       return res.status(409).json({ message: 'Email or phone number already in use' });
//     }
//     next(error);
//   }
};

exports.login = async (req, res, next) => {

};
exports.logout = async (req, res, next) => {

};

exports.refreshToken = async (req, res, next) => {

};
exports.sendPhoneOtp = async (req, res, next) => {

};
exports.verifyPhoneOtp = async (req, res, next) => {

};
exports.verifyEmailOtp = async (req, res, next) => {

};
exports.requestPasswordReset = async (req, res, next) => {

};
exports.resetPassword = async (req, res, next) => {

};
exports.lockAccount = async (req, res, next) => {

};




