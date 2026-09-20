import {Quaternion,Vector3} from 'three';
export function hatQuaternion(normal,yaw){if(!normal.toArray().every(Number.isFinite)||normal.lengthSq()<1e-10||!Number.isFinite(yaw))throw new Error('Invalid crown normal');return new Quaternion().setFromUnitVectors(new Vector3(0,1,0),normal.clone().normalize()).multiply(new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw));}
