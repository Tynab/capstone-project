import { AUTH_ACTIONS } from "../constants";

function userReducer(user, action) {
  switch (action.type) {
    case AUTH_ACTIONS.SET_USER: {
      return action.payload;
    }
    case AUTH_ACTIONS.UNSET_USER: {
      return {};
    }
    default:
      return user;
  }
}

export default userReducer;
