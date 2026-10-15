import userModel from "../models/userModel.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import validator from "validator";
import logger from "../utils/logger.js";

//create token
const createToken = (id, tokenVersion) => {
    return jwt.sign({id, tokenVersion}, process.env.JWT_SECRET, {
        expiresIn: 3 * 24 * 60 * 60
    })
}

// chỉ lộ các field an toàn cho client — không bao giờ trả password hash, resetToken hay tokenVersion
const toSafeUser = (user) => ({
    _id: user._id,
    name: user.name,
    email: user.email,
})

// Độ dài tối thiểu của mật khẩu. Trước đây không có ràng buộc nào ở tầng nào:
// mật khẩu một ký tự vẫn đăng ký được và vẫn đặt lại được.
const MIN_PASSWORD_LENGTH = 8

// Lỗi trùng khoá duy nhất của Mongo (E11000). Xảy ra khi hai request đăng ký
// cùng email chạy song song: cả hai đều qua được findOne rồi một request lỗi ở save.
const isDuplicateKeyError = (error) => error && error.code === 11000

// Hash bcrypt hợp lệ của một chuỗi bất kỳ, dùng làm "bia" khi email không tồn tại
// (xem loginUser). Giá trị không quan trọng vì kết quả so sánh luôn bị bỏ qua —
// mục đích duy nhất là để nhánh này tốn đúng một lần bcrypt cost 10.
const DUMMY_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

//login user
const loginUser = async (req,res) => {
    const {email, password} = req.body;
    try{
        // chặn operator injection TRƯỚC khi đưa vào filter: object {$ne: null} sẽ khớp user bất kỳ
        if(typeof email !== 'string' || typeof password !== 'string' || !email || !password){
            return res.status(400).json({message: "Please enter all fields"})
        }
        const user = await userModel.findOne({email})

        // Dùng CÙNG một thông báo cho "không có user" và "sai mật khẩu".
        // Hai thông báo khác nhau biến endpoint này thành công cụ dò email đã đăng ký.
        //
        // Không được return sớm khi thiếu user: bcrypt.compare tốn ~50-100ms, nên
        // nhánh "email không tồn tại" trả về nhanh hơn hẳn và thời gian phản hồi lại
        // thành công cụ dò email — đúng thứ mà thông báo chung đang cố che.
        const isMatch = await bcrypt.compare(password, user ? user.password : DUMMY_PASSWORD_HASH)
        if(!user || !isMatch){
            return res.status(400).json({message: "Invalid credentials"})
        }
        const token = createToken(user._id, user.tokenVersion || 0)
        res.status(200).json({user: toSafeUser(user), token})
    } catch (error) {
        // Không trả error.message: thông báo thô của Mongoose/JWT lộ chi tiết nội bộ
        logger.error("loginUser error:", error.message)
        res.status(500).json({message: "Login failed"})
    }
}

//register user
const registerUser = async (req,res) => {
    const {name, email, password} = req.body;
    try{
        // Validate TRƯỚC khi truy vấn: vừa chặn operator injection, vừa tránh cho findOne({email})
        // chạy trên giá trị chưa kiểm tra kiểu
        if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string'
            || validator.isEmpty(name) || validator.isEmpty(email) || validator.isEmpty(password)) {
            return res.status(400).json({message: "Please enter all fields"})
        }
        if(!validator.isEmail(email)){
            return res.status(400).json({message: "Please enter a valid email"})
        }
        if (password.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`})
        }
        //check if user already exists
        const exists = await userModel.findOne({email})
        if(exists){
            return res.status(400).json({message: "User already exists"})
        }
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt)

        const newUser = new userModel({name, email, password: hashedPassword})
        const user = await newUser.save()
        const token = createToken(user._id, user.tokenVersion || 0)
        res.status(200).json({user: toSafeUser(user), token})

    } catch(error){
        // Hai request đăng ký cùng email chạy song song thì findOne ở trên không
        // chặn được; lỗi thật sự nổ ra ở save() dưới dạng E11000. Map về đúng 400
        // thay vì để lộ chuỗi "E11000 duplicate key error collection: <db>.users...".
        if (isDuplicateKeyError(error)) {
            return res.status(400).json({message: "User already exists"})
        }
        logger.error("registerUser error:", error.message)
        res.status(500).json({message: "Registration failed"})
    }
}

//get user info
const getUser = async (req,res) => {
    const id = req.user.id
    try{
        const user = await userModel.findById(id)
        if(!user){
            return res.status(404).json({message: "User not found"})
        }
        res.status(200).json({user: toSafeUser(user)})
    } catch(error){
        // 502 là "bad gateway" — sai ngữ nghĩa cho lỗi nội bộ, phải là 500
        logger.error("getUser error:", error.message)
        res.status(500).json({message: "Could not load user"})
    }
}
export {loginUser, registerUser, getUser}
