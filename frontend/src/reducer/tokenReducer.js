import { AUTH_ACTIONS } from "../constants";

function tokenReducer(userToken, action) {
  switch (action.type) {
    case AUTH_ACTIONS.SET_TOKEN: {
      return action.payload;
    }
    case AUTH_ACTIONS.UNSET_TOKEN: {
      return null;
    }
    default:
      return userToken;
  }
}

export default tokenReducer;
