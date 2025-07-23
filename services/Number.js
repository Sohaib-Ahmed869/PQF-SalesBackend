// import-customers-mobile.js
const mongoose = require("mongoose");
const fs = require("fs");
const csv = require("csv-parser");
const Customer = require("../models/Customer"); // Adjust the path as necessary

mongoose.connect("mongodb+srv://sohaibsipra869:nvidia940MX@cluster0.q1so4va.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const customersToUpdate = [];

fs.createReadStream("contacts.csv") // Replace with your CSV path
  .pipe(csv())
  .on("data", (row) => {
    const email = row["Email"]?.trim();
    const primaryPhone = row["Phone Number"]?.trim();
    const mobilePhone = row["Mobile Phone Number"]?.trim();

    if (!mobilePhone || (!email && !primaryPhone)) return;

    customersToUpdate.push({ email, primaryPhone, mobilePhone });
  })
  .on("end", async () => {
    for (const { email, primaryPhone, mobilePhone } of customersToUpdate) {
      try {
        const customer = await Customer.findOne({
          $or: [
            { Email: email || undefined },
            { phoneNumber: primaryPhone || undefined },
          ],
        });

        if (!customer) {
          console.log(`No match found for: ${email || primaryPhone}`);
          continue;
        }

        if (!customer.additionalPhoneNumbers.includes(mobilePhone)) {
          customer.additionalPhoneNumbers.push(mobilePhone);
          await customer.save();
          console.log(`Updated customer: ${customer._id} with ${mobilePhone}`);
        }
      } catch (err) {
        console.error("Error updating customer:", err);
      }
    }

    console.log("Update complete.");
    mongoose.disconnect();
  });
