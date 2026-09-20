import {Matrix4,Vector3,Quaternion,Euler} from 'three';
export function uprightPlacement(anchor,config){return new Matrix4().compose(anchor,new Quaternion().setFromEuler(new Euler(...config.rotation)),new Vector3().setScalar(config.scale)).multiply(new Matrix4().makeTranslation(...config.propContact.map(v=>-v)));}
