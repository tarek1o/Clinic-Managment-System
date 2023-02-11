const mongoose = require("mongoose");
const bcrypt = require('bcrypt');
const saltRounds = 10;
const salt = bcrypt.genSaltSync(saltRounds);
require("../Models/doctorModel");
require("../Models/clinicModel");
require("../Models/appointmentModel");
require('../Models/usersModel');
const helper = require("../helper/helperFunctions");
const doctorSchema = mongoose.model("doctors");
const clinicSchema = mongoose.model("clinics");
const appointmentSchema = mongoose.model("appointments");
const UserSchema = mongoose.model('users');
const fs = require('fs')

exports.getAllDoctors = (request, response, next) => {
   let reqQuery = { ...request.query };
   let querystr = JSON.stringify(reqQuery);
   querystr = querystr.replace(/\b(gt|gte|lt|lte|in)\b/g, match => `$${match}`);
   let query;
   let query1 = doctorSchema.find(JSON.parse(querystr));
   let query2 = doctorSchema.find(JSON.parse(querystr))
      .populate({
         path: "clinic",
         select: { name: 1, location: 1, _id: 0 },
      });

      
   //Filter Fields 
   if (request.query.select) {
      if (request.query.select.includes('clinic')) {
         query = query2;
      } else {
         query = query1;
      }
      let selectFields = request.query.select.split(',').join(' ');
      query = query.select(selectFields);
   } else {
      query = query2
   }

   //Sort Fields
   if (request.query.sort) {
      let sortFields = request.query.sort.split(",").join(" ");
      query = query2.sort(sortFields);
      if (request.query.select) {
         let selectFields = request.query.select.split(',').join(' ');
         query = query1.select(selectFields).sort(sortFields);
         if(request.query.select.includes('clinic')){
            query = query2.select(selectFields).sort(sortFields);
         }
      }
   }

   query
      .then((data) => {
         response.status(200).json({ count: data.length, result: data });
      })
      .catch((error) => {
         next(error);
      });
}

//post required field only while email and password is post into user collection not doctor collection 
exports.addDoctor = (request, response, next) => {
   const hash = bcrypt.hashSync(request.body.password, salt);
   let bodyClinic = helper.intoNumber(...request.body.clinic);
   clinicSchema.find({_id: {$in: bodyClinic}}, {doctors: 1, _id: 0}).then((clinicData) => {
      if (clinicData.length == bodyClinic.length) {
         let doctorIds = [];
         clinicData.forEach((id) => {
            doctorIds.push(...id.doctors);
         })
         doctorSchema.find({_id: {$in: doctorIds}}, {firstName: 1, lastName: 1, _id: 0})
            .then((doctorData) => {
               let flag = doctorData.some(function (doctor) {
                  return request.body.firstName == doctor.firstName && request.body.lastName == doctor.lastName
               })
               if (flag) {
                  next(new Error("You cannot add two doctors with the same name in the same clinic"));
               }
               else {
                  UserSchema.findOne({email: request.body.email}).then(function(data){
                     if(data == null) {
                        let newDoctor = new doctorSchema(
                           {
                              firstName: request.body.firstName,
                              lastName: request.body.lastName,
                              age: request.body.age,
                              address: request.body.address,
                              phone: request.body.phone,
                              clinic: bodyClinic,
                              specialty: request.body.specialty,
                              image: "uploads\\images\\doctors\\doctor.png"
                        });
                        newDoctor.save().then((result) => {
                              clinicSchema.updateMany({ _id: {$in: request.body.clinic}}, {$push: {doctors: result._id}})
                              .then(function () {
                                 let newUser = new UserSchema({
                                    email: request.body.email,
                                    password: hash,
                                    userId: result._id,
                                    role: 'doctor'
                                 })
                                 newUser.save().then(function() {
                                    response.status(200).json(result)
                                 })
                              }).catch((error) => {
                                 next(error);
                              });
                        }).catch((error) => {
                           next(error);
                        });
                     }
                     else {
                        next(new Error("This email is already used"));
                     }
                  }).catch(function(error) {
                     next(error);
                  })
               }
            });
      }
      else {
         next(new Error("One of these clinics dosen't exist"));
      }
   })
};

exports.getDoctorById = (request, response, next) => {
   if(request.id == request.params.id || request.role == 'admin') {
      doctorSchema.findOne({_id: request.params.id})
      .populate({
         path: "clinic",
         select: {location: 1, _id: 0}
      })
      .then((data) => {
         if (data) {
            response.status(201).json(data);
         } else {
            next(new Error("Doctor does not exist"));
         }
      })
      .catch((error) => {
         next(error);
      });
   }
   else {
      let error = new Error('Not allow for you to show the information of this doctor');
      error.status = 403;
      next(error);
   }
};

exports.updateDoctorById = (request, response, next) => {
   if(request.body.clinic != undefined) {
      clinicSchema.find({_id: {$in: request.body.clinic}})
         .then((clinicData) => {
            if (clinicData.length == request.body.clinic.length) {
               clinicSchema.updateMany({_id: {$in: request.body.clinic}}, {$push: {doctors: parseInt(request.params.id)}})
                  .then(function () {
                     updateDoctor(request, response, next)
                  });
            } 
            else {
               next(new Error("One of entered clinics does not exist"));
            }
         });
   }
   else {
      updateDoctor(request, response, next)         
   }
};

exports.changeDoctorImageById = (request, response, next) => {
   doctorSchema.updateOne({id: request.params.id}, {
      $set: {
         image: request.file.path
      }
   }).then(function(result) {
      if(result.modifiedCount == 0) {
         response.status(200).json({Updated: true, Message: "Nothing is changed"});
      }
      else {
         response.status(200).json({Updated: true, Message: "The image is updated successfully"});
      }
   })
}

exports.deleteDoctorById = (request, response, next) => {   
   UserSchema.deleteOne({role: "doctor", userId: request.params.id}).then(function() {
      doctorSchema.findOneAndDelete({
         _id: request.params.id
      }).then(result => {
         if(result != null) {            
            appointmentSchema.deleteOne({
               doctorName: parseInt(request.params.id)
            }).then(function() {
                  clinicSchema.updateMany({
                     doctors: parseInt(request.params.id)
                  }, {
                     $pull: { doctors: parseInt(request.params.id) }
                  }).then(function(){
                     fs.unlink("uploads\\images\\doctors\\" + request.params.id + ".png", function (result) {
                        if (result) {
                           console.log("This image is not found");
                           response.status(200).json({Deleted: false});
                        } else {
                           console.log("File removed:", "uploads\\images\\doctors\\" + request.params.id + ".png");
                           response.status(200).json({Deleted: true});
                        }
                     });
                  }).catch(error => {
                     next(error);
                  });
               }).catch(error => {
                  next(error);
               });
         }
         else {
            let error = new Error("This doctor is not found")
            error.status = 403;
            next(error);
         }
         }).catch(error => {
            next(error);
         })
   })
};

function updateDoctor(request, response, next) {
   let nameProperty = ["firstName", "lastName", "age", "address", "phone", "clinic", "specialty"]
   let doctorData = {};
   for(let prop of nameProperty) {
      if(request.body[prop] != null) {
         doctorData[prop] = request.body[prop];
      }
   }
   if(doctorData != {}) {
      doctorSchema.updateOne({_id: request.params.id}, {$set: doctorData})
         .then((result) => {
            if(result.modifiedCount == 0) {
               response.status(200).json({Updated: true, Message: "Nothing is changed"});
            }
            else {
               response.status(200).json({Updated: true, Message: "Doctor is updated successfully"});
            }
         })
         .catch((error) => {
            next(error);
         });
   }
   else {
      response.status(200).json({Updated: true, Message: "Nothing is changed"});
   }
}