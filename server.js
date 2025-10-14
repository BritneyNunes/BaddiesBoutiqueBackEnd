const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const { Base64 } = require('js-base64');
require("dotenv").config();
const cors = require('cors');

//port number
const port = 3000;
const app = express();

app.use(cors({
  origin: "*", // or your S3 URL
  methods: ["GET", "POST", "DELETE", "PUT"],
}));


const URI = process.env.URI;
const VITE_API_URL = process.env.VITE_API_URL;

// Middleware
app.use(express.json());

let client, db;

// Function to connect to MongoDB
async function connectToMongo() {
    console.log("Attempting to connect to MongoDB..." + URI);
    try {
        client = new MongoClient(URI);
        await client.connect();
        db = client.db("BaddiesBoutique");
        console.log("Successfully connected to MongoDB!");
    } catch (error) {
        console.error("MongoDB connection error:", error);
        console.log(URI)
        throw error;
    }
}

// Middleware for basic authentication
async function basicAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Basic ")) {
        return res.status(401).json({ message: "Authorization header missing or invalid" });
    }
    const base64Credentials = authHeader.split(" ")[1];
    if (!base64Credentials) {
        return res.status(400).json({ message: "Invalid Basic Authorization format" });
    }
    const credentials = Base64.decode(base64Credentials).split(":");
    const email = credentials[0];
    const password = credentials[1].trim();
    const collection = db.collection("Users");
    const user = await collection.findOne({ Email: email });

    if (!user || Base64.decode(user.Password) !== password) {
        return res.status(401).json({ message: "Invalid email or password" });
    }
    req.user = user;
    next();
}


// --- PUBLIC ENDPOINTS (No authentication required) ---

// Endpoint to handle sign up
app.post("/signup", async (req, res) => {
    try {
        const newUser = req.body;
        const encodedPassword = Base64.encode(newUser.password);
        const userToInsert = { ...newUser, Password: encodedPassword, createdAt: new Date() };
        delete userToInsert.password;

        const collection = db.collection("Users"); 
        const result = await collection.insertOne(userToInsert);

        res.status(201).send({
            msg: "User has been successfully posted",
            userId: result.insertedId 
        });
    } catch (error) {
        console.error("Could not post user:", error);
        res.status(500).send("Could not post user");
    }
});

// Create a new user account
app.post("/users", async (req, res) => {
    try {
        const { NameAndSurname, Email, Password, Gender, UserNumber } = req.body.data;
        if (!Email || !Password) {
            return res.status(400).json({ message: "Email and password are required" });
        }
        const collection = db.collection("Users");
        const existingUser = await collection.findOne({ Email });
        if (existingUser) {
            return res.status(409).json({ message: "User with this email already exists" });
        }
        const encodedPassword = Base64.encode(Password);
        const newUser = {
            CustomerID: new Date().getTime(), NameAndSurname, Email,
            Password: encodedPassword, Gender, UserNumber,
            createdAt: new Date(), updatedAt: new Date()
        };
        const result = await collection.insertOne(newUser);
        res.status(201).json({
            message: "User created successfully",
            user: { Email: newUser.Email, _id: result.insertedId }
        });
    } catch (error) {
        console.error("Error creating user:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Get All Brands
app.get("/brands", async (req, res) => {
    try {
        const collection = db.collection("Brands");
        const brands = await collection.find({}).toArray();
        res.status(200).json(brands);
    } catch (error) {
        console.error("Error getting brands:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Get All Parts
app.get("/parts", async (req, res) => {
    try {
        const collection = db.collection("Parts");
        const parts = await collection.find({}).toArray();
        res.status(200).json(parts);
    } catch (error) {
        console.error("Error retrieving parts:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});




// Access the Cart and Orders collection
let cartCollection;
let ordersCollection;

// POST - Add item to cart
app.post("/cart", async (req, res) => {
    try {
        // Ensure the cartCollection is initialized
        if (!cartCollection) {
            cartCollection = db.collection("Cart");
        }

        // Get the item from the request body
        const item = req.body;
        console.log("Received item for cart:", req.body);
        // Check if the item and its _id are valid
        if (!item || !item._id) {
            return res.status(400).json({ error: "Invalid item" });
        }
        
        // Convert the _id from a string to a MongoDB ObjectId
        // This is important for database queries
        const objectId = new ObjectId(item._id);

        // Check if the item already exists in the cart using the ObjectId
        const existingItem = await cartCollection.findOne({ _id: objectId });
        if (existingItem) {
            return res.status(400).json({ error: "Item already in cart" });
        }

        // Insert the new item into the cart
        await cartCollection.insertOne({ ...item, _id: objectId });
        
        // Respond with success
        res.status(201).json(item);
    } catch (error) {
        console.error("Error adding to cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// GET - Fetch all cart items
app.get("/cart", async (req, res) => {
    try {
        if (!cartCollection) cartCollection = db.collection("Cart");
        const cartItems = await cartCollection.find({}).toArray();
        res.status(200).json(cartItems);
    } catch (error) {
        console.error("Error retrieving cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// DELETE - Remove item from cart
app.delete("/cart/:id", async (req, res) => {
    try {
        if (!cartCollection) cartCollection = db.collection("Cart");
        const { id } = req.params;

        // You should convert the ID to a MongoDB ObjectId here too
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }

        const result = await cartCollection.deleteOne({ _id: new ObjectId(id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "Item not found in cart" });
        }
        const cartItems = await cartCollection.find({}).toArray();
        res.status(200).json({ message: "Item removed", cart: cartItems });
    } catch (error) {
        console.error("Error removing item from cart:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// --- NEW ORDERS ENDPOINTS ---
// POST - Create a new order with all cart items
app.post("/orders", async (req, res) => {
  try {
    if (!ordersCollection) {
      ordersCollection = db.collection("Orders");
    }
    
    const orderData = req.body; // The entire JSON object from the frontend
    
    // You can add validation here to ensure the data is what you expect
    if (!orderData || !orderData.products || orderData.products.length === 0) {
      return res.status(400).json({ message: "Order data is incomplete or empty." });
    }

    const result = await ordersCollection.insertOne(orderData);
    
    res.status(201).json({ 
        message: "Order placed successfully!", 
        orderId: result.insertedId 
    });
  } catch (error) {
    console.error("Error placing order:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// GET - Fetch all orders
app.get("/orders", async (req, res) => {
  try {
    if (!ordersCollection) {
      ordersCollection = db.collection("Orders");
    }
    const orders = await ordersCollection.find({}).toArray();
    res.status(200).json(orders);
  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ message: "Internal server error." });
  }
});

// Get Parts by ID
app.get("/parts/:id", async (req, res) => {
    try {
        const collection = db.collection("Parts");
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid ID format" });
        }
        const part = await collection.findOne({ _id: new ObjectId(id) });
        if (!part) {
            return res.status(404).json({ message: "Part not found" });
        }
        res.status(200).json(part);
    } catch (error) {
        console.error("Error retrieving part:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

app.use(basicAuth);

// --- AUTHENTICATED ENDPOINTS (Require basicAuth header) ---
// All routes after this line will require basic authentication

// User Login / Password Check
app.get("/checkpassword", async (req, res) => {
    try {
        const user = req.user;
        const decodedPassword = Base64.decode(user.Password);
        const providedPassword = req.headers.authorization.split(" ")[1];
        const decodedProvidedPassword = Base64.decode(providedPassword).split(":")[1].trim();

        if (decodedPassword === decodedProvidedPassword) {
            res.status(200).json({ message: "Password is correct" });
        } else {
            res.status(401).json({ message: "Password is incorrect" });
        }
    } catch (error) {
        console.error("Error checking password:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


// Get User Profile
app.get("/users/profile", async (req, res) => {
    try {
        const user = req.user;
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }
        const userProfile = {
            NameAndSurname: user.NameAndSurname,
            Email: user.Email,
            Gender: user.Gender,
            UserNumber: user.UserNumber,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
        res.status(200).json(userProfile);
    } catch (error) {
        console.error("Error fetching user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Update User Profile
app.put("/users/profile", async (req, res) => {
    try {
        const { NameAndSurname, Email, Gender, UserNumber } = req.body;
        const { _id } = req.user;
        const collection = db.collection("Users");
        const updateDoc = {
            $set: {
                NameAndSurname,
                Email,
                Gender,
                UserNumber,
                updatedAt: new Date(),
            },
        };
        const result = await collection.updateOne({ _id: new ObjectId(_id) }, updateDoc);
        if (result.matchedCount === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        const updatedUser = await collection.findOne({ _id: new ObjectId(_id) });
        const userProfile = {
            NameAndSurname: updatedUser.NameAndSurname,
            Email: updatedUser.Email,
            Gender: updatedUser.Gender,
            UserNumber: updatedUser.UserNumber,
            createdAt: updatedUser.createdAt,
            updatedAt: updatedUser.updatedAt,
        };
        res.status(200).json({ message: "Profile updated successfully", userProfile });
    } catch (error) {
        console.error("Error updating user profile:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Delete User Account
app.delete("/users/profile", async (req, res) => {
    try {
        const { _id } = req.user;
        const collection = db.collection("Users");
        const result = await collection.deleteOne({ _id: new ObjectId(_id) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ message: "User not found" });
        }
        res.status(200).json({ message: "Account deleted successfully" });
    } catch (error) {
        console.error("Error deleting user account:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});

// Start the server and connect to MongoDB
async function startServer() {
    try {
        await connectToMongo();
        app.listen(port, "0.0.0.0", () => {
            console.log(`Server listening at http://0.0.0.0/0:${port}`);
        });
    } catch (err) {
        console.error("Failed to connect to MongoDB or start server:", err);
        process.exit(1);
    }
}

startServer();