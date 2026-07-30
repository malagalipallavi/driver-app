const firebaseConfig = {
  apiKey:            "AIzaSyCp5ek6_DSolwbSaHinsL09ifLua5__-Dw",
  authDomain:        "college-bus-tracker-b94c6.firebaseapp.com",
  databaseURL:       "https://college-bus-tracker-11fce-default-rtdb.firebaseio.com",
  projectId:         "college-bus-tracker-b94c6",
  storageBucket:     "college-bus-tracker-b94c6.firebasestorage.app",
  messagingSenderId: "1078002082605",
  appId:             "1:1078002082605:android:09bfebcbc237abeb2629a4"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
alert('Firebase ready: ' + (typeof db));